import { Flex } from "@radix-ui/themes";
import { useEffect, useState } from "preact/hooks";
import { READ_ONLY } from "../constants/settings";
import useTwitch from "../hooks/useTwitch";
import type Widget from "../models/Widget";

const settings = [...READ_ONLY];

export default {
  id: "chat",
  description: "Display Twitch chat.",
  settings: settings,
  render: ({ channels }) => {
    const [messages, setMessages] = useState<string[]>([]);

    useEffect(() => {
      useTwitch({ channels: channels.split(",") }).then((twitch) => {
        twitch.on("message", (channel, tags, message) => {
          setMessages((o) => [`[${channel}] ${tags.username}: ${message}`, ...o].slice(0, 10));
        });
      });
    }, [channels]);

    return (
      <Flex direction="column-reverse">
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </Flex>
    );
  },
} as Widget<typeof settings>;
