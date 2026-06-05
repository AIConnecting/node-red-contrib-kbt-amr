module.exports = function (RED) {
    const net = require("net");

    const PORT_CONFIG = 19207;

    // Landmark list request
    // ถ้าทดสอบแล้วไม่ตรง ให้เปลี่ยน msg type ตรงนี้
    const MSG_LANDMARK_LIST = 3053;

    function packMsg(reqId, msgType, payload) {
        const jsonStr = JSON.stringify(payload || {});
        const jsonLen = Buffer.byteLength(jsonStr, "ascii");

        const buf = Buffer.alloc(16 + jsonLen);
        let offset = 0;

        buf.writeUInt8(0x5A, offset); offset += 1;
        buf.writeUInt8(0x01, offset); offset += 1;
        buf.writeUInt16BE(reqId, offset); offset += 2;
        buf.writeUInt32BE(jsonLen, offset); offset += 4;
        buf.writeUInt16BE(msgType, offset); offset += 2;
        buf.fill(0x00, offset, offset + 6); offset += 6;
        buf.write(jsonStr, offset, "ascii");

        return buf;
    }

    function unpackMsg(buf) {
        if (!Buffer.isBuffer(buf) || buf.length < 16) {
            return {
                ok: false,
                error: "Invalid response header",
                raw: buf
            };
        }

        const jsonLen = buf.readUInt32BE(4);
        const msgType = buf.readUInt16BE(8);

        let data = {};
        if (jsonLen > 0 && buf.length >= 16 + jsonLen) {
            try {
                data = JSON.parse(
                    buf.slice(16, 16 + jsonLen).toString("ascii")
                );
            } catch (e) {
                return {
                    ok: false,
                    error: "JSON parse error",
                    raw: buf.toString("hex")
                };
            }
        }

        return {
            ok: true,
            msgType,
            jsonLen,
            data
        };
    }

    function sendTcp(ip, port, buffer, timeoutMs) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            let chunks = [];

            const timer = setTimeout(() => {
                client.destroy();
                reject(new Error("TCP timeout"));
            }, timeoutMs || 5000);

            client.connect(port, ip, () => {
                client.write(buffer);
            });

            client.on("data", (data) => {
                chunks.push(data);
                clearTimeout(timer);
                client.destroy();
                resolve(Buffer.concat(chunks));
            });

            client.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });

            client.on("close", () => {
                clearTimeout(timer);
            });
        });
    }

    function normalizeLandmarks(data) {
        if (Array.isArray(data)) {
            return data;
        }

        if (data && Array.isArray(data.landmarks)) {
            return data.landmarks;
        }

        if (data && Array.isArray(data.Landmarks)) {
            return data.Landmarks;
        }

        if (data && Array.isArray(data.data)) {
            return data.data;
        }

        if (data && Array.isArray(data.list)) {
            return data.list;
        }

        if (data && Array.isArray(data.points)) {
            return data.points;
        }

        if (data && Array.isArray(data.POI)) {
            return data.POI;
        }

        return [];
    }

    function LandmarkListNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;
        node.robot_ip = config.robot_ip;
        node.timeout = Number(config.timeout || 5);

        node.on("input", async function (msg) {
            node.status({
                fill: "blue",
                shape: "dot",
                text: "reading landmarks..."
            });

            try {
                const req = packMsg(1, MSG_LANDMARK_LIST, {});
                const resBuf = await sendTcp(
                    node.robot_ip,
                    PORT_CONFIG,
                    req,
                    node.timeout * 1000
                );

                const res = unpackMsg(resBuf);
		if (res.data.ret_code !== undefined && Number(res.data.ret_code) !== 0) {
    		msg.payload = {
        		status: "error",
        		message: res.data.err_msg || "API error",
        		ret_code: res.data.ret_code,
        		response: res
    		};

    		node.status({
        		fill: "red",
        		shape: "dot",
        		text: "error " + res.data.ret_code
    		});

    		node.send([null, msg]);
    			return;
		}
                if (res.ok !== true) {
                    msg.payload = {
                        status: "error",
                        message: res.error,
                        response: res
                    };

                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "error"
                    });

                    node.send([null, msg]);
                    return;
                }

                const landmarks = normalizeLandmarks(res.data);

                msg.payload = {
                    status: "success",
                    landmarks: landmarks,
                    count: landmarks.length,
                    raw: res.data,
                    response: res
                };

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: landmarks.length + " landmarks"
                });

                node.send([msg, null]);

            } catch (err) {
                msg.payload = {
                    status: "error",
                    message: err.message,
                    action: "landmark_list"
                };

                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "error"
                });

                node.send([null, msg]);
            }
        });
    }

    RED.nodes.registerType("landmark-list", LandmarkListNode);
};