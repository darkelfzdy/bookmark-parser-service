import { Bookmark, Category } from './types';

// Internal types for tree building
interface TempBookmark {
	type: 'bookmark';
	name: string;
	url: string;
}

interface TempFolder {
	type: 'folder';
	name: string;
	children: (TempFolder | TempBookmark)[];
}

// Internal types for event stream
type Event =
	| { type: 'enter_level' }
	| { type: 'exit_level' }
	| { type: 'folder'; name: string }
	| { type: 'bookmark'; name: string; url: string };

export async function parseBookmarks(html: string): Promise<Category[]> {
	if (!html || !html.trim()) {
		return [];
	}

	// --- Stage 1: HTML -> Event Stream ---
	const events: Event[] = [];
	let lastBookmark: { name: string; url: string } | null = null;

	const rewriter = new HTMLRewriter()
		.on('dl', { element: () => events.push({ type: 'enter_level' }) })
		.on('dl:end', { element: () => events.push({ type: 'exit_level' }) })
		.on('h3', {
			text: (text) => {
				if (text.text) {
					events.push({ type: 'folder', name: text.text.trim() });
				}
			},
		})
		.on('a', {
			element: (el) => {
				lastBookmark = { url: el.getAttribute('href') || '', name: '' };
			},
			text: (text) => {
				if (lastBookmark && text.text) {
					lastBookmark.name += text.text;
					if (text.lastInTextNode) {
						events.push({ type: 'bookmark', ...lastBookmark });
						lastBookmark = null;
					}
				}
			},
		});

	await rewriter.transform(new Response(html)).text();

	// --- Stage 2: Event Stream -> Memory Tree ---
	const root: TempFolder = { type: 'folder', name: 'root', children: [] };
	const stack: TempFolder[] = [root];

	for (const event of events) {
		let currentFolder = stack[stack.length - 1];
		switch (event.type) {
			case 'enter_level':
				const lastChild = currentFolder.children.length > 0 ? currentFolder.children[currentFolder.children.length - 1] : null;
				if (lastChild && lastChild.type === 'folder') {
					stack.push(lastChild);
				} else {
                    stack.push(currentFolder);
                }
				break;
			case 'exit_level':
				if (stack.length > 1) {
					stack.pop();
				}
				break;
			case 'folder':
				currentFolder.children.push({ type: 'folder', name: event.name, children: [] });
				break;
			case 'bookmark':
				currentFolder.children.push({ type: 'bookmark', name: event.name.trim(), url: event.url });
				break;
		}
	}

	// --- Stage 3: Memory Tree -> Final JSON (Flattening) ---
	const finalCategories: Category[] = [];
	const unclassified: Bookmark[] = [];

	const topLevelFolders = root.children.filter((c) => c.type === 'folder') as TempFolder[];
	const topLevelBookmarks = root.children.filter((c) => c.type === 'bookmark') as TempBookmark[];

	const collectBookmarks = (folder: TempFolder): Bookmark[] => {
		let bms: Bookmark[] = [];
		for (const child of folder.children) {
			if (child.type === 'bookmark') {
				bms.push({ name: child.name, url: child.url });
			} else if (child.type === 'folder') {
				bms = bms.concat(collectBookmarks(child));
			}
		}
		return bms;
	};

	if (topLevelFolders.length === 1) {
		const singleRootFolder = topLevelFolders[0];
		for (const child of singleRootFolder.children) {
			if (child.type === 'folder') {
				finalCategories.push({
					name: child.name,
					bookmarks: collectBookmarks(child),
				});
			} else if (child.type === 'bookmark') {
				unclassified.push({ name: child.name, url: child.url });
			}
		}
	} else { 
		for (const folder of topLevelFolders) {
			finalCategories.push({
				name: folder.name,
				bookmarks: collectBookmarks(folder),
			});
		}
	}

	unclassified.push(...topLevelBookmarks.map((b) => ({ name: b.name, url: b.url })));

	if (unclassified.length > 0) {
		finalCategories.push({
			name: '未分类书签',
			bookmarks: unclassified,
		});
	}

	return finalCategories;
}