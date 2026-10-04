import { readFile } from "node:fs/promises";
import { backupState, restoreState } from "../server/state-backup.js";

const [mode, parent, target, input, ack] = process.argv.slice(2);
if (mode === "backup") {
	const spec = JSON.parse(await readFile(input, "utf8"));
	await backupState(
		parent,
		target,
		spec.components,
		spec.metadata,
		ack === "--writers-stopped",
	);
} else if (mode === "restore") await restoreState(parent, target, input);
else
	throw new Error(
		"Usage: state-backup.ts backup PARENT NEW_TARGET SPEC --writers-stopped | restore PARENT NEW_TARGET SNAPSHOT",
	);
console.log(
	`${mode} verified; private output: ${target}; files only: apply quarantine SQL/budget policy and isolated configuration BEFORE starting services`,
);
