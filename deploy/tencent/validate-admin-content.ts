// Bundle as CommonJS with esbuild; executed without network or database access.
import { listContent } from "../../admin/server/content.js";

async function main() {
	const root = process.argv[2];
	if (!root) throw new Error("Content root required");
	const result = {};
	for (const kind of ["posts", "dynamic"] as const) {
		const page = await listContent(root, {
			kind,
			search: "",
			status: "all",
			page: 1,
			pageSize: 10000,
		});
		if (kind === "posts" && !page.total) throw new Error("Empty posts");
		Object.assign(result, { [kind]: page });
	}
	console.log(JSON.stringify(result));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
