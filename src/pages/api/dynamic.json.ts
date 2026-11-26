import { getLocalDynamicEntries } from "@/utils/dynamic-server";

export async function GET(): Promise<Response> {
	const data = await getLocalDynamicEntries();

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
