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
  { min: 0, minSeeds: 1, text: 'Botanists confirm: every carrot this year is a little bit you. Not a metaphor.' },
  { min: 0, minSeeds: 1, text: 'Heirloom seed prices soar. Yours are not for sale.' },
  { min: 0, minSeeds: 10, text: 'Tenth-generation carrots exhibit “ancestral memory of being clicked.”' },
];

CC.RABBIT_NEWS = [
  'A golden rabbit was seen! Clicked, negotiated with, and befriended.',
  'The golden rabbit strikes a deal. Everyone profits. Mostly you.',
];
