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

Zoned tiles also carry a **level** (0–4) and a **land value** (0–255). Level is
how far a block has grown; land value is what the neighbourhood is worth, and it
is what decides whether a block grows at all.

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

## What you can build

Cost is one-off. Upkeep is charged per day, forever, whether or not the tile is
doing anything for you.

| Key | Tile | Cost | Upkeep/day |
|:---:|---|---:|---:|
| `1` | Road | 10 | 0.22 |
| `2` | Residential | 90 | 1.0 |
| `3` | Commercial | 130 | 1.6 |
| `4` | Industrial | 170 | 2.2 |
| `5` | Park | 60 | 1.8 |
| `6` | Bus Stop | 240 | 5.0 |
| `7` | City Grocery | 420 | 9.0 |
| `8` | Childcare | 520 | 11.0 |
| `9` | Public Clinic | 680 | 14.0 |
| `s` | Public School | 600 | 12.0 |
| `t` | Social Housing | 900 | 16.0 |
| `0` | Bulldoze | 4 | — |

The upkeep column is the whole budget problem. Services are what make a
neighbourhood worth living in, and they are also what bankrupt a mayor who builds
them faster than the tax base grows.

## Buildings are lots, not tiles

Neighbouring tiles of one kind are grouped into **lots** — rectangles from 1x1 up
to 3x3 — and each lot is given an architectural archetype based on its kind,
level and size. A 3x3 block of high-level commercial is not nine shops; it is one
building with an atrium.

So zoning in blocks looks different from zoning in scattered single tiles, and
looks better as the level climbs: `row` and `perim` become `towers`, `strip`
becomes `mall` and then `rotunda`.

## The platform

Twelve policies, each unlocked by population. Most cost money every day; two make
money. All of them are trade-offs, not upgrades.

| Policy | Unlocks at pop | Cost/day |
|---|---:|---:|
| Rent Freeze | 250 | 40 |
| Fare-Free Buses | 300 | 180 |
| Free School Meals | 400 | 60 |
| Trash Containerization | 500 | 55 |
| City-Owned Groceries | 600 | 120 |
| Dept. of Community Safety | 700 | 70 |
| Tax the Top Bracket | 800 | **−160** |
| $30 Minimum Wage | 900 | 25 |
| Ferries to Everywhere | 1,000 | 90 |
| Universal Childcare | 1,200 | 240 |
| Congestion Pricing | 1,500 | **−60** |
| Public Power | 2,200 | 260 |

A rent freeze holds rent down and slows new housing. Taxing high earners funds
everything and cools commercial growth. Free buses are transformative and get
more expensive with every resident you attract. Congestion pricing raises money
and annoys drivers.

There is no build order that wins for free.

## Taxes

Residential, commercial and industrial rates are set independently. Raising a
rate raises daily income now and suppresses growth in that zone type, which
lowers income later. The interesting decisions are in that gap.

## Things that happen to a city

Once a game day the simulation may fire an event, gated by weight, a cooldown,
and a condition — so a subway flood needs a subway problem and a budget crisis
needs a budget. Each one gives you a choice, and each choice costs you something.

Weather and disaster: snow days, heatwaves, hurricanes, blackouts, water mains,
potholes. Transit: subway floods, the L train, bus contracts, fare evasion,
dollar vans, bike lane fights. Politics and money: the Wall Street lobby, budget
crises, the Albany budget, tabloid front pages, landlord suits. And rats. There
is a rat summit.

## Overlays

The map can be shaded by `value`, `traffic` or `pollution` instead of drawn
plainly. Use them before you build, not after — the land value overlay is the
fastest way to see why a block refuses to grow.

## Term and endgame

Four years, counted in game days. The city keeps simulating while you watch: day
and night pass over the map, traffic animates along the roads you laid, and
approval drifts with every decision.

The game ends when the term does. Approval at that moment is the score.

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

Progress saves locally, and can be reset from the HUD.
