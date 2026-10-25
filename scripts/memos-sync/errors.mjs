// Fixed categories only: exception messages may contain credentials or source data.
export function errorReason(error) {
	if (error?.message === "Run deadline exceeded") return "run-deadline";
	if (error?.name === "TimeoutError") return "network-timeout";
	if (error?.name === "TypeError") return "network-or-type-error";
	if (Number.isInteger(error?.status)) return "api-http";
	if (
		/^(Managed (image|file) conflict|Dynamic slug collision)/u.test(
			error?.message ?? "",
		)
	)
		return "managed-file-conflict";
	if (/^Git [a-z-]+ failed;/u.test(error?.message ?? ""))
		return "git-operation";
	if (error?.message === "Deployment evidence timeout")
		return "deployment-timeout";
	if (
		/^(Unsupported image data|Unsupported or unsafe attachment|Unsupported animation|Attachment length mismatch|Run attachment byte limit exceeded|Image transparency lost)$/u.test(
			error?.message ?? "",
		)
	)
		return "image-validation";
	return "unknown";
}
