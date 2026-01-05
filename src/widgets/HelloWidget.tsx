import { useEffect } from "preact/hooks";
import { READ_WRITE } from "../constants/settings";
import useTwitch from "../hooks/useTwitch";
import type { Setting } from "../models/Setting";
import type Widget from "../models/Widget";

const settings = [
  ...READ_WRITE,
  {
    id: "command",
    hint: "Bind behavior on a !command.",
  } as Setting<string>,
];

export default {
  id: "hello",
  description: "Say hello back on command.",
  settings: settings,
  render: ({ channels, username, token, command }) => {
    const correctedCommand = command.startsWith("!") ? command : `!${command}`;

    useEffect(() => {
      useTwitch({ channels: channels.split(","), username, token }).then((twitch) =>
        twitch.on("message", (channel, tags, message, self) => {
          if (self) return;
          if (message.toLowerCase() === correctedCommand) {
            twitch.say(channel, `@${tags.username}, heya!`);
          }
        })
      );
    }, []);

    return <></>;
  },
} as Widget<typeof settings>;
