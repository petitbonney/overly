# 0006. Polls and bets support native Twitch and chat-vote modes

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Twitch Polls and Predictions are only available to Affiliate and Partner channels. Many small streamers have neither, but still want polls and bets.

## Decision

The Poll and Bets widgets support two modes, **chosen per widget**:

- **native**: Twitch Polls and Predictions through the Helix API;
- **chat vote**: viewers vote in chat (`!vote <n>`, `!bet <n>`), and Overly counts.

## Alternatives considered

- **Native only:** excludes channels that aren't Affiliate or Partner.
- **Chat vote only:** ignores the native UI viewers already know, and Channel Points wagers.

## Consequences

- Both modes share actions (`start`, `end`, `open`, `lock`, `resolve`) and events, so pipelines don't care which mode is used.
- The UI detects when native mode isn't available and explains why.
