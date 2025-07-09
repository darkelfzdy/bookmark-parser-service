export interface Bookmark {
  name: string;
  url: string;
}

export interface Category {
  name: string;
  bookmarks: Bookmark[];
}
