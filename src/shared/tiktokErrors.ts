/** TikTok Content Posting API error codes, in plain words. */
const MESSAGES: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "This app hasn't passed TikTok's audit, so Direct Post only works when the TikTok account is set to Private. Use Draft to Inbox, or make the account private.",
  privacy_level_option_mismatch: "That privacy option isn't allowed for this account. Pick one from the list.",
  url_ownership_unverified: "TikTok hasn't verified the image URL. Check URL properties in the developer portal.",
  spam_risk_too_many_posts: "TikTok's daily post limit for this account was hit.",
  spam_risk_too_many_pending_share: "Too many drafts are waiting in this account's inbox. Publish or delete some in the TikTok app.",
  spam_risk_user_banned_from_posting: "This account is currently blocked from posting.",
  reached_active_user_cap: "The app hit TikTok's daily limit of posting users.",
  rate_limit_exceeded: "Too many requests to TikTok. Wait a minute and try again.",
  access_token_invalid: "The TikTok login expired or was revoked. Connect the account again.",
  scope_not_authorized: "This account didn't grant the needed permission. Connect it again.",
  scope_permission_missed: "The app is missing a permission in the TikTok portal (e.g. Direct Post).",
  invalid_file_upload: "TikTok rejected the file. Check its format and size.",
  file_format_check_failed: "TikTok rejected the file format.",
  duration_check_failed: "The video is too long or too short for your account.",
  frame_rate_check_failed: "Frame rate must be 23–60 fps.",
  picture_size_check_failed: "Image or video dimensions aren't supported.",
  video_pull_failed: "TikTok couldn't download the video URL.",
  photo_pull_failed: "TikTok couldn't download the images. Is the R2 URL verified in the TikTok portal?",
  publish_cancelled: "The post was cancelled.",
  auth_removed: "The app's access was removed. Connect again.",
  invalid_grant: "TikTok no longer accepts this login (access was removed or it ran out). Connect the account again.",
  spam_risk_text: "TikTok flagged the caption text.",
  spam_risk: "TikTok flagged this post as spam risk.",
  internal: "TikTok had an internal error. Try again.",
  internal_error: "TikTok had an internal error. Try again.",
};

/** Plain-English message for a TikTok error/fail_reason code; falls back to TikTok's text plus the code. */
export function describeTikTokError(code: string, message?: string): string {
  // Entries saved before codes were kept only have TikTok's generic text for this case.
  if (/integration guidelines/i.test(code)) return MESSAGES.unaudited_client_can_only_post_to_private_accounts;
  return MESSAGES[code] ?? (message && message !== code ? `${message} (${code})` : code);
}
