import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Fetch/browser disallow these ports even when the OS considers them available.
// Keep OS-assigned ports; only close/reselect this fixture's own listener.
const forbidden = new Set([
	1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
	6668, 6669, 6697, 10080,
]);
export async function listenLocal(server: Server): Promise<AddressInfo> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (
			address &&
			typeof address !== "string" &&
			address.port >= 1024 &&
			!forbidden.has(address.port)
		)
			return address;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
	throw new Error("无法分配浏览器可访问的隔离空闲端口");
}
