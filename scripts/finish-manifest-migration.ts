// Trusted developer operation only: replace the exact two AST property initializers.
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

for (const [file, property, replacement] of [
	[
		"src/config/musicConfig.ts",
		"playlist",
		"playlistFromManifest(musicManifest)",
	],
	[
		"src/config/galleryConfig.ts",
		"albums",
		"albumsFromManifest(galleryManifest)",
	],
]) {
	const source = await readFile(file, "utf8");
	const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const matches: ts.PropertyAssignment[] = [];
	function visit(node: ts.Node) {
		if (ts.isPropertyAssignment(node) && node.name.getText(ast) === property)
			matches.push(node);
		ts.forEachChild(node, visit);
	}
	visit(ast);
	if (
		matches.length !== 1 ||
		!ts.isArrayLiteralExpression(matches[0].initializer)
	)
		throw new Error("Expected one literal migration target");
	const value = matches[0].initializer;
	await writeFile(
		file,
		source.slice(0, value.getStart(ast)) +
			replacement +
			source.slice(value.end),
	);
}
