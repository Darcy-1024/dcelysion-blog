export type CommentStatus = "approved" | "waiting" | "spam";
export type Comment = {
	objectId: string;
	comment: string;
	nick: string;
	url: string;
	status: CommentStatus;
	pid: string;
	rid: string;
	user_id: string;
	insertedAt: string;
	updatedAt: string;
	fingerprint: string;
	article?: string;
};
export type User = {
	objectId: string;
	display_name: string;
	email: string;
	url: string;
	type: string;
	label: string;
	fingerprint: string;
};
export type Page<T> = {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	pages: number;
};
export type Thread = Omit<Page<Comment>, "items"> & {
	item: Comment;
	thread: Comment[];
	deleteCount: number;
};
export type Account = User & { twoFactorEnabled: boolean };
export type ManagementInfo = {
	source: string;
	securityUrl: string;
	overlay: string;
};
export type BackendSession = {
	id: string;
	created: string;
	expires: string;
	current: boolean;
};
