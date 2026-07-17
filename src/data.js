/* Carrot Clicker — content: buildings, upgrades, ribbons, news. */
globalThis.CC = globalThis.CC || {};

CC.BUILDINGS = [
  { name: 'Window Box', cost: 15, cps: 0.1,
    flavor: 'Three carrots in a trough. Humble. Ambitious.',
    upName: 'Southern Exposure', upFlavor: 'The sun finds them every morning. They lean into it.' },
  { name: 'Garden Plot', cost: 100, cps: 1,
    flavor: 'A proper row of your own. The neighbors are watching.',
    upName: 'Double Digging', upFlavor: 'Two spades deep. The taproots sing.' },
  { name: 'Allotment', cost: 1100, cps: 8,
    flavor: 'Committee-approved carrot production. The bees came free.',
    upName: 'Committee Approval', upFlavor: 'Your motion passes 7–2. The parsnip man abstains, furiously.' },
  { name: 'Market Stall', cost: 12000, cps: 47,
    flavor: 'Sells out by nine. The parsnip man is livid.',
    upName: 'Heritage Certification', upFlavor: 'A laminated sign that says HEIRLOOM. Sales triple. Nothing else changed.' },
  { name: 'Greenhouse', cost: 130000, cps: 260,
    flavor: 'Climate-controlled. The carrots believe it is always June.',
    upName: 'Automatic Misters', upFlavor: 'A fine rain, always at the perfect moment. The carrots applaud quietly.' },
  { name: 'Rabbit Union', cost: 1.4e6, cps: 1400,
    flavor: 'They stopped eating the crop once you offered dental.',
    upName: 'Collective Bargaining', upFlavor: 'The rabbits now guard the rows they once raided. Solidarity forever.' },
  { name: 'Carrot Combine', cost: 2e7, cps: 7800,
    flavor: 'Harvests a field a minute. Slightly haunted.',
    upName: 'Gentler Tines', upFlavor: 'Each carrot is held, briefly, on its way up. Reviews are positive.' },
  { name: 'Mycorrhizal Exchange', cost: 3.3e8, cps: 44000,
    flavor: 'The fungal stock market. The Tomato rings the opening bell.',
    upName: 'Insider Rooting', upFlavor: 'The Parsnip knew about the drought before the clouds did. No charges filed.' },
  { name: 'Orbital Polytunnel', cost: 5.1e9, cps: 260000,
    flavor: 'In space, every direction is down. Taproots love it.',
    upName: 'Aeroponic Chorus', upFlavor: 'Roots humming in the mist. Ground control weeps gently.' },
  { name: 'Carrot Singularity', cost: 7.5e10, cps: 1.6e6,
    flavor: 'All carrots, everywhere, all at once.',
    upName: 'The Long Flowering', upFlavor: 'It blooms. Continents pollinate. Somewhere, a fair judge faints.' },
];

/* Building upgrades are generated at these owned-counts; each doubles that building. */
CC.TIERS = [
  { need: 10, costMult: 10, prefix: null },      /* tier 0 uses the building's own upName */
  { need: 25, costMult: 75, prefix: 'Deeper' },
  { need: 50, costMult: 600, prefix: 'Ancestral' },
  { need: 100, costMult: 5000, prefix: 'Mythic' },
];

/* Any upgrade below (click / global / synergy) may carry an optional
   `unlock: [ ... ]` list that REPLACES its type's default visibility rule;
   every condition must hold. Conditions (see DESIGN.md "Unlock conditions"):
     { owned: i, n: N }   own ≥ N of building index i (0 = Window Box, …)
     { lifetime: N }      lifetime harvest ≥ N carrots
     { seeds: N }         seeds ≥ N
     { clicks: N }        lifetime clicks ≥ N
     { bought: 'id' }     another upgrade already bought
     { shed: 'id' }       Potting Shed item already bought (R13)
   Example — a click upgrade that appears only after 50 Garden Plots and
   another purchase:  unlock: [{ owned: 1, n: 50 }, { bought: 'c0' }]
   Without `unlock`, defaults apply: click/global show at lifetime ≥ cost/4;
   synergy at needTarget/needPer. Combining primitives here never requires
   touching core.js or economy.py (DESIGN P7). */
CC.CLICK_UPGRADES = [
  { id: 'c0', name: 'Calloused Thumb', cost: 100, mult: 2,
    flavor: 'The blister becomes a callus. The callus becomes technique.' },
  { id: 'c1', name: 'Two-Handed Pull', cost: 2500, mult: 2,
    flavor: 'One hand pulls, the other steadies the earth. Teamwork.' },
  { id: 'c2', name: 'Grandma’s Trowel', cost: 50000, cpsPct: 0.01,
    flavor: 'It remembers every harvest it has ever made. Clicks gain +1% of your CpS.' },
  { id: 'c3', name: 'Proper Technique', cost: 5e6, mult: 3,
    flavor: 'Grip the shoulders, never the greens. Everyone knows this. Nobody does it.' },
  { id: 'c4', name: 'Green Thumbs (Both)', cost: 5e8, cpsPct: 0.02,
    flavor: 'Medically inexplicable. Horticulturally undeniable. Clicks gain +2% of your CpS.' },
];

CC.GLOBAL_UPGRADES = [
  { id: 'g0', name: 'Companion Planting', cost: 75000, mult: 1.10,
    flavor: 'Marigolds at the borders. Everyone grows braver together. +10% everything.' },
  { id: 'g1', name: 'Heirloom Genes', cost: 1e7, mult: 1.15,
    flavor: 'Purple Dragon. Parisian Round. The old names still carry weight. +15% everything.' },
  { id: 'g2', name: 'Free-Range Carrots', cost: 2e9, mult: 1.20,
    flavor: 'They roam. They return. Don’t ask how. +20% everything.' },
  { id: 'g3', name: 'Second Spring', cost: 3e11, mult: 1.25,
    flavor: 'Winter files a formal complaint. It is not upheld. +25% everything.' },
];

/* Bumper crops: every building type grants +1% GLOBAL production at each
   of these owned-counts. Quantity anywhere always pays off everywhere. */
CC.MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400, 500];
CC.MILESTONE_MULT = 1.01;

/* Synergies: cross-tier upgrades — the target building gains +pct per
   `per` building owned. Visible once you own enough of both. */
CC.SYNERGY_UPGRADES = [
  { id: 's0', name: 'Sill-to-Stall Pipeline', cost: 500000, target: 0, per: 3, pct: 0.05,
    needTarget: 25, needPer: 10,
    flavor: 'Every sill in town feeds your stalls. Window Boxes gain +5% per Market Stall.' },
  { id: 's1', name: 'Crop Rotation', cost: 2e6, target: 1, per: 4, pct: 0.05,
    needTarget: 25, needPer: 10,
    flavor: 'The plots rest; the greenhouse doesn’t. Garden Plots gain +5% per Greenhouse.' },
  { id: 's2', name: 'Union Allotments', cost: 2e7, target: 2, per: 5, pct: 0.05,
    needTarget: 25, needPer: 10,
    flavor: 'The rabbits dig. The committee approves. Allotments gain +5% per Rabbit Union.' },
  { id: 's3', name: 'Combine Cooperative', cost: 2e8, target: 3, per: 6, pct: 0.05,
    needTarget: 25, needPer: 10,
    flavor: 'Stalls sell what the combine pulls. Market Stalls gain +5% per Carrot Combine.' },
  { id: 's4', name: 'Greenhouse Futures', cost: 2e9, target: 4, per: 7, pct: 0.05,
    needTarget: 25, needPer: 10,
    flavor: 'June, traded openly on the exchange. Greenhouses gain +5% per Mycorrhizal Exchange.' },
  { id: 's5', name: 'Windowsill Wide Web', cost: 5e10, target: 0, per: 7, pct: 0.20,
    needTarget: 100, needPer: 15,
    flavor: 'Every window box, networked. Window Boxes gain +20% per Mycorrhizal Exchange.' },
  { id: 's6', name: 'Orbital Union Charter', cost: 5e11, target: 5, per: 8, pct: 0.10,
    needTarget: 50, needPer: 10,
    flavor: 'Space rabbits. Unionized. Rabbit Unions gain +10% per Orbital Polytunnel.' },
];

/* The Potting Shed (R13): permanent perks bought with SPROUTS — the seed's
   spendable twin. Going to seed mints 1 sprout per seed; seeds themselves
   are never spent (+8% each, forever). Shed purchases survive prestige.
   The catalog is completable by design: every item is strictly positive and
   nothing is exclusive, so "no matter what happens, eventually every sprout
   will be purchased — it just might not be the most optimal way". Prices
   are pacing knobs (DESIGN "Tunables"), not choices. Future items may gate
   other content via unlock: [{ shed: 'id' }]. */
CC.SHED = [
  /* R15 schema — one mechanism, many shapes. A one-shot item is level 0→1;
     `repeat: true` items climb forever (or to `max`) at
     ceil(cost·costGrowth^level) sprouts. Effects reuse engine shapes only:
       mult      global production, applied mult^level
       building+bmult   that building's output, bmult^level
       cpsPct    clicks gain +cpsPct·level of CpS
       mintMult  sprouts minted per seed at prestige, ^level
       resprout  building starts each spring at min(level, 100) owned
     `unlock: [...]` (R8 vocabulary + the R15 counters) gates visibility.
     GROWTH BUDGET: each uncapped ladder adds β = ln(effect)/ln(costGrowth)
     to the world's polynomial growth rate. Compost 0.254 + heirlooms 0.257
     + Fair Circuit 0.098 + Almanac headroom 0.03 = 0.64 — the budget is 1;
     tests/sim.js asserts < 0.75. Spend the rest wisely. */
  { id: 'p0', name: 'Potting Bench', cost: 5, mult: 1.05,
    flavor: 'Somewhere to stand, somewhere to plan. The whole world leans on it.' },
  { id: 'p1', name: 'Cold Frame', cost: 25, mult: 1.08,
    flavor: 'A little glass roof against the frost. Spring arrives whenever you lift the lid.' },
  { id: 'p2', name: 'Heirloom Seed Library', cost: 125, mult: 1.10,
    flavor: 'Every variety the world ever grew, filed under W for wonderful.' },
  { id: 'p3', name: 'The Grafting Table', cost: 625, mult: 1.12,
    flavor: 'Two gardens, one stem. The judges have questions; the carrots have answers.' },
  /* keystones: the day-one splurge, revealed as the world spends and springs */
  { id: 'p4', name: 'Rainwater Cistern', cost: 5000, mult: 1.15,
    flavor: 'Every storm, banked. The garden drinks on schedule now.' },
  { id: 'p5', name: 'Bee Cooperative', cost: 50000, mult: 1.15, unlock: [{ sproutsSpent: 1e6 }],
    flavor: 'Unionized pollination. The rabbits sent organizers.' },
  { id: 'p6', name: 'Seed Vault', cost: 500000, mult: 1.20, unlock: [{ prestiges: 10 }],
    flavor: 'Deep in the hillside, every spring that ever was, waiting.' },
  { id: 'p7', name: 'Orrery of Junes', cost: 5e6, mult: 1.25, unlock: [{ sproutsSpent: 25e6 }],
    flavor: 'Brass rings, tiny suns. It is always the best week of June somewhere in it.' },
  { id: 'p8', name: 'The Perennial Engine', cost: 5e7, mult: 1.30, unlock: [{ prestiges: 40 }],
    flavor: 'It runs on continuity. Nobody remembers starting it.' },
  /* sprout-mint doublers: multi-hundred-prestige savings goals, ×100 apart */
  { id: 'p9', name: 'Propagation Bench', cost: 25e6, mintMult: 2,
    flavor: 'One cutting becomes two. The mathematics of generosity.' },
  { id: 'p10', name: 'Mist House', cost: 2.5e9, mintMult: 2,
    flavor: 'A building made of weather. Cuttings root out of sheer comfort.' },
  { id: 'p11', name: 'Tissue-Culture Lab', cost: 250e9, mintMult: 2,
    flavor: 'A carrot in a jar, dreaming of being thousands.' },
  { id: 'p12', name: 'The Nursery Moon', cost: 25e12, mintMult: 2,
    flavor: 'A second moon, but greenhouse. Rises only over the potting shed.' },
  /* the grounds: repeatable ladders — the shed can be finished; the grounds never are */
  { id: 'l0', name: 'Compost Heap', cost: 10000, costGrowth: 1.04, repeat: true, mult: 1.01,
    flavor: 'Turn it again. Everything the garden was becomes what it will be.' },
  { id: 'l1', name: 'Sprinkler Network', cost: 100000, costGrowth: 3, repeat: true, max: 6,
    cpsPct: 0.005,
    flavor: 'Every click lands a little wetter. Clicks gain +0.5% of CpS per valve.' },
  /* heirloom strains (R15): one per building, ×1.10 per level, and the
     strain resprouts each spring — min(level, 100) already in the ground */
  { id: 'h0', name: 'Parisian Round', building: 0, bmult: 1.10, cost: 100, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Round as a coin, sweet as a secret. The sill was always big enough.' },
  { id: 'h1', name: 'Amsterdam Forcing', building: 1, bmult: 1.10, cost: 250, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Forced? Encouraged, firmly.' },
  { id: 'h2', name: 'Nantes Half-Long', building: 2, bmult: 1.10, cost: 625, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'The committee measured. Exactly half-long. Motion carried.' },
  { id: 'h3', name: 'Chantenay Red-Core', building: 3, bmult: 1.10, cost: 1560, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'The red core sells itself; the stall just holds it.' },
  { id: 'h4', name: 'Oxheart', building: 4, bmult: 1.10, cost: 3910, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'A carrot the size of a fist, a heart the size of June.' },
  { id: 'h5', name: 'Cosmic Purple', building: 5, bmult: 1.10, cost: 9770, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'The rabbits demanded purple. Nobody asked why. Solidarity.' },
  { id: 'h6', name: 'Autumn King', building: 6, bmult: 1.10, cost: 24400, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Crowned each fall; harvested by appointment.' },
  { id: 'h7', name: 'St. Valery', building: 7, bmult: 1.10, cost: 61000, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Old French stock. The fungi approve of tradition.' },
  { id: 'h8', name: 'Scarlet Keeper', building: 8, bmult: 1.10, cost: 153000, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Keeps for months. In vacuum, forever.' },
  { id: 'h9', name: 'Lunar White', building: 9, bmult: 1.10, cost: 381000, costGrowth: 1.45,
    repeat: true, resprout: true,
    flavor: 'Pale as moonlight. All carrots, eventually, are a little bit this one.' },
];

/* Ribbons: permanent multipliers at lifetime-harvest milestones (your trophy shelf). */
CC.RIBBONS = [
  { at: 1e3, name: 'White Ribbon', color: '#e5e7eb', mult: 1.02,
    flavor: 'Third place at the village fête. It’s a start.' },
  { at: 1e5, name: 'Red Ribbon', color: '#dc2626', mult: 1.03,
    flavor: 'Second place. The judge lingered.' },
  { at: 1e7, name: 'Blue Ribbon', color: '#3b82f6', mult: 1.05,
    flavor: 'First place. Somewhere, a gardener nods.' },
  { at: 1e9, name: 'Best in Show', color: '#8b5cf6', mult: 1.08,
    flavor: '“In forty years of judging…” — you know the rest.' },
  { at: 1e11, name: 'Purple Rosette', color: '#c026d3', mult: 1.12,
    flavor: 'Awarded once a century, to a garden rather than a carrot.' },
  { at: 1e13, name: 'The Judge’s Tears', color: '#67e8f9', mult: 1.15,
    flavor: 'There is no category for what you have grown. They give you the tears directly.' },
  /* The Fair Circuit (R14): one rung per decade of lifetime harvest, ×1.12
     each, 1e14 → 1e45. Populates the nine-decade dead zone the live world
     had already crossed and then outlasts a 250-day projection. Growth-rate
     budget (β = ln1.12/ln10 per decade ≈ 0.10 of the expansion's 0.63 total)
     is documented against the projection test. Full circuit: ×37.6. */
  { at: 1e14, name: 'County Sash', color: '#d9a83f', mult: 1.12,
    flavor: 'Worn diagonally. Nobody explains the diagonal.' },
  { at: 1e15, name: 'Parish Perpetual Cup', color: '#c9962f', mult: 1.12,
    flavor: 'Engraved with every winner since 1811. All carrots now.' },
  { at: 1e16, name: 'The Golden Trowel', color: '#e0b45a', mult: 1.12,
    flavor: 'Retired from competition. Awarded to you anyway.' },
  { at: 1e17, name: 'Regional Root Medal', color: '#b8860b', mult: 1.12,
    flavor: 'The region has been redrawn twice to keep you eligible.' },
  { at: 1e18, name: 'The Minister’s Ribbon', color: '#daa520', mult: 1.12,
    flavor: 'Pinned by the Minister of Agriculture, hands trembling.' },
  { at: 1e19, name: 'Royal Warrant', color: '#9b1c3a', mult: 1.12,
    flavor: 'By appointment: purveyor of carrots to the Crown.' },
  { at: 1e20, name: 'The Empire Vegetable Prize', color: '#7a1f5c', mult: 1.12,
    flavor: 'The empire in question dissolved. The prize endures.' },
  { at: 1e21, name: 'Continental Grand Cordon', color: '#4b2a8a', mult: 1.12,
    flavor: 'Seven nations share one sash. It is yours.' },
  { at: 1e22, name: 'The Laureate’s Greens', color: '#2f4bb5', mult: 1.12,
    flavor: 'A wreath of carrot tops. Photosynthesis included.' },
  { at: 1e23, name: 'World’s Fair Grand Prix', color: '#1f6fb5', mult: 1.12,
    flavor: 'The fair built a pavilion just to hold the applause.' },
  { at: 1e24, name: 'The Blue Marble Rosette', color: '#12889e', mult: 1.12,
    flavor: 'Visible from orbit, briefly, during the ceremony.' },
  { at: 1e25, name: 'Hemispheric Harvest Seal', color: '#0f9b6e', mult: 1.12,
    flavor: 'Both hemispheres. The paperwork took years.' },
  { at: 1e26, name: 'The Tomato’s Concession', color: '#2aa84a', mult: 1.12,
    flavor: 'The Tomato rings the bell in your honor. No hard feelings.' },
  { at: 1e27, name: 'Planetary Soil Star', color: '#74b32a', mult: 1.12,
    flavor: 'The soil itself signed the citation. Do not ask how.' },
  { at: 1e28, name: 'The Parsnip Man’s Blessing', color: '#b3a125', mult: 1.12,
    flavor: 'He wept. He meant it. He grows carrots now.' },
  { at: 1e29, name: 'Lunar Exposition Medal', color: '#d98a25', mult: 1.12,
    flavor: 'Awarded in the Sea of Tranquility’s first allotment tent.' },
  { at: 1e30, name: 'The Tidal Lock Trophy', color: '#d95f25', mult: 1.12,
    flavor: 'The Moon agrees to always face your garden.' },
  { at: 1e31, name: 'Heliotrope Order', color: '#c0c8e8', mult: 1.12,
    flavor: 'The sun leans in for a closer look, every morning.' },
  { at: 1e32, name: 'The Perihelion Prize', color: '#93a7e8', mult: 1.12,
    flavor: 'Awarded once per orbit, at closest approach. For the view.' },
  { at: 1e33, name: 'Asteroid Belt Cordon', color: '#6b84e0', mult: 1.12,
    flavor: 'A ribbon of rocks, arranged into a bow.' },
  { at: 1e34, name: 'The Gas Giant Garland', color: '#4f5fd0', mult: 1.12,
    flavor: 'Jupiter’s spot is now slightly carrot-shaped.' },
  { at: 1e35, name: 'Kuiper Krown', color: '#3a3fb0', mult: 1.12,
    flavor: 'Spelling approved by committee, 7–2. The parsnip man abstained.' },
  { at: 1e36, name: 'The Heliopause Honor', color: '#2a2a90', mult: 1.12,
    flavor: 'Where the solar wind ends, your rows continue.' },
  { at: 1e37, name: 'Interstellar Seed Sigil', color: '#33196b', mult: 1.12,
    flavor: 'Etched on a golden record. Mostly carrot recipes.' },
  { at: 1e38, name: 'The Nebula Nosegay', color: '#521b8a', mult: 1.12,
    flavor: 'A bouquet of star-stuff, wilting over ten thousand years.' },
  { at: 1e39, name: 'Galactic Grange Fellowship', color: '#7a1bb0', mult: 1.12,
    flavor: 'The grange meets Thursdays, galaxy-time.' },
  { at: 1e40, name: 'The Spiral Arm Sash', color: '#a11bd0', mult: 1.12,
    flavor: 'Worn diagonally across four hundred billion stars.' },
  { at: 1e41, name: 'Supercluster Cup', color: '#c81bde', mult: 1.12,
    flavor: 'Too heavy to lift. Displayed in situ.' },
  { at: 1e42, name: 'The Cosmic Web Weave', color: '#e81bd0', mult: 1.12,
    flavor: 'Filaments of everything, braided like greens.' },
  { at: 1e43, name: 'Order of the First Furrow', color: '#f06bd8', mult: 1.12,
    flavor: 'Dug before time. Harvested by you.' },
  { at: 1e44, name: 'The Heat Death Ribbon', color: '#f8b8e8', mult: 1.12,
    flavor: 'Awarded at the end of everything. Kept in advance.' },
  { at: 1e45, name: 'The Last Rosette', color: '#fff7d6', mult: 1.12,
    flavor: 'There are no more categories. There is only the garden.' },
];

/* News ticker: shown when lifetime harvest ≥ min (and seeds ≥ minSeeds if set). */
CC.NEWS = [
  { min: 0, text: 'Your window box is the talk of the sill.' },
  { min: 0, text: 'Tip: carrots come out of the ground when you click them. Science!' },
  { min: 100, text: 'Local rabbit spotted “just looking.” Authorities unconvinced.' },
  { min: 500, text: 'The parsnip man has filed his first complaint.' },
  { min: 2000, text: 'Carrot shaped like a hand waves at commuters. Morale improves.' },
  { min: 10000, text: 'Scientists confirm carrots can hear. Sales of kind words triple.' },
  { min: 10000, text: 'The parsnip man’s second complaint is used to wrap carrots.' },
  { min: 50000, text: 'Row three declared a site of special horticultural interest.' },
  { min: 200000, text: 'Rabbit union demands: dental, hazard pay, and one (1) carrot each. Granted.' },
  { min: 200000, text: 'Carrot futures up. The Tomato winks at reporters.' },
  { min: 1e6, text: 'Nation switches to carrot-based economy “to see what happens.”' },
  { min: 1e6, text: 'The parsnip man attempts a rival stall. A single, silent rabbit watches him all day.' },
  { min: 1e7, text: 'Archaeologists find 12th-century carrot. It is still crunchy. Investigation ongoing.' },
  { min: 1e8, text: 'Carrot combine develops feelings. Given a small hat as compensation. Productivity soars.' },
  { min: 1e8, text: 'Weather forecast now sponsored by your greenhouse. Forecast: June.' },
  { min: 1e9, text: 'First carrot in orbit reports: “every direction is down.” Mission control weeps.' },
  { min: 1e9, text: 'The parsnip man concedes. You hire him. He is… actually great with compost?' },
  { min: 1e10, text: 'Moon declared “technically an allotment.” Committee approval pending.' },
  { min: 1e11, text: 'The Carrot Singularity hums a note only rabbits can hear. They approve.' },
  { min: 1e12, text: 'Interdimensional carrot monopoly denies being a monopoly in this dimension.' },
  { min: 1e13, text: 'Historians agree history was mostly leading up to this.' },
  { min: 1e14, text: 'County declared “mostly carrot.” Census adjusted accordingly.' },
  { min: 1e16, text: 'The Golden Trowel retired from competition. Committee cites “basic fairness.”' },
  { min: 1e19, text: 'The Crown requests carrots. The Crown waits in line like everyone else.' },
  { min: 1e23, text: 'World’s Fair unveils permanent carrot pavilion. Attendance doubles, twice.' },
  { min: 1e26, text: 'The Tomato concedes the market and rings the bell in your honor.' },
  { min: 1e29, text: 'First allotment on the Moon reports excellent drainage.' },
  { min: 1e38, text: 'Nebula reclassified as “bouquet.” Astronomers furious; florists thrilled.' },
  { min: 1e45, text: 'The Last Rosette is awarded. The garden continues anyway.' },
  { min: 0, minSeeds: 1, text: 'Botanists confirm: every carrot this year is a little bit you. Not a metaphor.' },
  { min: 0, minSeeds: 1, text: 'The Potting Shed opens its doors. Every sprout will find a pot eventually.' },
  { min: 0, minSeeds: 1, text: 'Heirloom seed prices soar. Yours are not for sale.' },
  { min: 0, minSeeds: 10, text: 'Tenth-generation carrots exhibit “ancestral memory of being clicked.”' },
];

CC.RABBIT_NEWS = [
  'A golden rabbit was seen! Clicked, negotiated with, and befriended.',
  'The golden rabbit strikes a deal. Everyone profits. Mostly you.',
];
