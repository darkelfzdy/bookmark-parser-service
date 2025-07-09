import { parseBookmarks } from './parser';

export interface Env {}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const contentType = request.headers.get('content-type');
		if (!contentType || !contentType.includes('text/html')) {
			return new Response('Unsupported Media Type. Please use Content-Type: text/html.', { status: 415 });
		}

		try {
			const html = await request.text();
			const categories = await parseBookmarks(html);
			return new Response(JSON.stringify(categories, null, 2), {
				headers: { 'Content-Type': 'application/json' },
				status: 200,
			});
		} catch (error) {
			console.error('Error parsing bookmarks:', error);
			const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
			return new Response(`Internal Server Error: ${errorMessage}`, { status: 500 });
		}
	},
};