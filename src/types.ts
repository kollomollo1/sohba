export type Profile = {
  id: string;
  full_name: string;
  username: string;
  is_demo_account?: boolean;
  bio: string | null;
  avatar_url: string | null;
  friends_only_feed: boolean;
  last_urgent_post_at: string | null;
  created_at: string;
};

export type FriendshipContext = 'self' | 'friend' | 'friend_of_friend' | 'community';
export type LikeReaction = 'like' | 'laugh' | 'angry' | 'surprised';

export type FeedPost = {
  id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  image_public_id?: string | null;
  is_urgent: boolean;
  created_at: string;
  author_name: string;
  author_username: string;
  author_avatar: string | null;
  ctx_kind: FriendshipContext;
  ctx_mutual_name: string | null;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_reaction?: LikeReaction | null;
  reaction_counts?: Partial<Record<LikeReaction, number>>;
  status?: 'approved' | 'pending_approval' | 'rejected';
};

export type Comment = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_username: string;
  author_avatar: string | null;
};

export type Person = {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  relation: 'friend' | 'requested' | 'incoming' | 'none';
  mutual_count: number;
};

export type FriendRequest = {
  request_id: string;
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  mutual_count: number;
  created_at: string;
};

export type Friend = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
};
