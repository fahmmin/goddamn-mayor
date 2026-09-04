# The game

An isometric New York City-builder that runs in a window next to your IDE.

You are the Mayor. You have four years, a treasury, and a city that will tell you
loudly when you get it wrong. Zone it, wire it with roads and buses, pass the
platform you ran on, and try to still be popular when the term is up.

Built to be played in the gaps — while a build runs, while a test suite churns,
while an agent is thinking. Glance over, lay two blocks, glance back.

## The board

A 48x48 tile grid. One tick is one game hour; 24 ticks make a day. Every tile is
one of: empty land, water, road, a zone (residential, commercial, industrial), a
park, or a service building.

## The core loop

1. **Lay roads.** Nothing grows without one.
2. **Zone beside them** — homes, shops, industry.
3. **Watch the three numbers** and react.
4. **Pass policies** when you can afford them.
5. **Survive the events** the city throws at you.

Repeat until the term ends.

## The one rule that matters

**Nothing grows without a road.** Zone next to roads, or you are paying upkeep on
empty lots.

## The three numbers

| Number | What it means when it moves |
|---|---|
| **Rent** | The heart of the game. Let it run and approval bleeds and people leave. |
| **Unemployment** | You zoned homes without jobs. |
| **Traffic** | You built roads where you needed buses. |

## Policies are trade-offs, not upgrades

A rent freeze holds rent down and slows new housing. Taxing high earners funds
everything and cools commercial growth. Free buses are transformative and get
more expensive with every resident you attract.

There is no build order that wins for free.

## Controls

| | |
|---|---|
| `1`-`9`, `s`, `t`, `0` | pick a build tool |
| Left-drag | build / paint |
| Right-drag | pan the city |
| Wheel | zoom |
| Arrows | pan |
| Space | pause / resume |
| `+` / `-` | game speed |
| `m` | mute |
