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

export async function parseBookmarks(html: string): Promise<Category[]> {
	if (!html || !html.trim()) {
		return [];
	}

	// --- Stage 1: Directly build a lightweight memory tree ---
	const root: TempFolder = { type: 'folder', name: 'root', children: [] };
	const stack: TempFolder[] = [root];
	let lastTextParent: TempFolder | null = null;
    let lastBookmark: TempBookmark | null = null;

	const rewriter = new HTMLRewriter()
		.on('dl', {
			element: () => {
                // When we enter a <dl>, the parent folder is the one on top of the stack.
                // The actual folder for this <dl> is the *last* folder that was added to the parent.
				const parent = stack[stack.length - 1];
				const folderForThisDl = parent.children.slice().reverse().find(c => c.type === 'folder') as TempFolder | undefined;
				
                if (folderForThisDl) {
					stack.push(folderForThisDl);
				}
			},
			end: () => {
				// Exit a level of nesting
				if (stack.length > 1) {
					stack.pop();
				}
			},
		})
		.on('h3', {
			element: () => {
				// Prepare for the folder name text
				lastTextParent = stack[stack.length - 1];
			},
			text: (text) => {
				// Create the new folder and add it to the current parent
				if (text.text && lastTextParent) {
					lastTextParent.children.push({ type: 'folder', name: text.text.trim(), children: [] });
				}
                if (text.lastInTextNode) {
                    lastTextParent = null;
                }
			},
		})
		.on('a', {
			element: (el) => {
                // Create a bookmark object, ready to receive its name
				lastBookmark = { type: 'bookmark', url: el.getAttribute('href') || '', name: '' };
			},
			text: (text) => {
				if (lastBookmark && text.text) {
                    // Append text chunks to the name (handles multi-line names)
					lastBookmark.name += text.text;
					if (text.lastInTextNode) {
						const parent = stack[stack.length - 1];
						parent.children.push(lastBookmark);
						lastBookmark = null;
					}
				}
			},
		});

	await rewriter.transform(new Response(html)).text();

	// --- Stage 2: Memory Tree -> Final JSON (Flattening) ---
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
		// "Smart Drilldown" mode
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
		// "Standard" mode
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