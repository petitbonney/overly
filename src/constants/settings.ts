import type { Setting } from "../models/Setting";

// SHARED SETTINGS
export const CHANNELS: Setting<string> = {
  id: "channels",
  hint: "Comma-separated list of channels to connect to.",
  required: true,
};

export const USERNAME: Setting<string> = {
  id: "username",
  hint: "Username of your Twitch account that will be used for interactions.",
  required: true,
};

export const TOKEN: Setting<string> = {
  id: "token",
  hint: "An OAuth token with at least the chat:read and/or chat:edit scopes.",
  hintLink: "https://twitchtokengenerator.com/",
  required: true,
};

// DEFAULT SETTINGS GROUPS
export const READ_ONLY = [CHANNELS];
export const READ_WRITE = [CHANNELS, USERNAME, TOKEN];
