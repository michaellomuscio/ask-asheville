// Guided investigations: a big question worked through in four moves (predict, explore, explain,
// go further). The content below is plain data so the teacher guide can list it too; the Guide class
// draws it inside the Questions panel and drives the map through the same question engine students
// type into. Nothing here is hard-coded from the data: every "check your reading" value is computed
// live, so it always matches what the map shows.
//
// Placeholders in question strings: {pick} = the place chosen on that step, {place} = the place the
// whole investigation is about ("my spot" when the student has set one).

const STARTERS = ['My claim: ___, because ___.', 'The strongest evidence is ___.', 'Something that could change my answer is ___.'];

export const INVESTIGATIONS = [
  {
    id: 'help-arrives',
    icon: 'siren',
    title: 'Does where you live change how fast help arrives?',
    blurb: 'In an emergency, minutes matter. Buncombe County’s goal is for an ambulance to arrive within 8 minutes 59 seconds, nine times out of ten. Find out how much the wait depends on where you are.',
    minutes: 15,
    skills: ['Reading maps', 'Fair comparisons', 'Models'],
    predict: {
      prompt: 'Barnardsville is a small community in the north of the county. How much longer do you think an ambulance takes to get there than to downtown Asheville?',
      choices: ['About the same', 'A few minutes longer', 'More than twice as long', 'I’m not sure yet'],
      text: 'Why do you think so?',
    },
    steps: [
      { title: 'Start downtown', say: 'Ask how fast an ambulance can reach the center of the city after a 911 call.', button: 'Ask about downtown', ask: 'How fast can an ambulance get to downtown?',
        notice: 'What does the time include besides the drive?' },
      { title: 'Now a place far from the city', say: 'Ask the same question about Barnardsville. Keep everything else the same so the comparison is fair.', button: 'Ask about Barnardsville', ask: 'How fast can an ambulance get to Barnardsville?',
        notice: 'How do the two times compare? Is each one inside the county’s goal?',
        check: { q: 'After the ambulance arrives, how long is the ride to an emergency room?', ask: 'How far is the nearest emergency room from Barnardsville?', show: 'sub' } },
      { title: 'See the whole county at once', say: 'The response map colors every road by how long an ambulance takes to arrive. Green is fast. Red and dark areas wait the longest.', button: 'Show the response map', ask: 'Show the ambulance response map',
        notice: 'Where are the red and dark areas? What do those places have in common?',
        check: { q: 'What share of residents can an ambulance reach within 8 minutes of driving?', ask: 'What share of people can an ambulance reach in 8 minutes?', show: 'headline' } },
      { title: 'Try a place you know', say: 'Pick a place, then ask. You can also type any address or neighborhood in the bar at the top.', button: 'Ask about this place', ask: 'How fast can an ambulance get to {pick}?',
        pick: ['Black Mountain', 'Leicester', 'Fairview', 'Weaverville', 'West Asheville'],
        notice: 'Was it faster or slower than you expected? Why might that be?' },
      { title: 'What would help?', say: 'The search tests hundreds of spots on main roads and counts how many more people each one would bring inside the goal.', button: 'Search for the best new base', ask: 'Where should a new ambulance base go?',
        notice: 'Would you build it there? What else would you need to know first?' },
    ],
    findings: [
      { label: 'Ambulance to downtown Asheville', ask: 'How fast can an ambulance get to downtown?' },
      { label: 'Ambulance to Barnardsville', ask: 'How fast can an ambulance get to Barnardsville?' },
    ],
    limit: 'These times come from a model. It assumes an ambulance is sitting in its base, ready to go, and it uses typical road speeds. Real crews are often already out on another call, and the county’s own study found that real waits were longer.',
    extend: ['How fast can a fire truck get to Barnardsville?', 'What is the closest hospital to Leicester?', 'How many people live within 15 minutes of Mission Hospital?'],
    discuss: ['Is it fair for emergency response times to differ across one county? What would it take to make them equal?', 'The model assumes a crew is always in the station and ready. How would real life be different?', 'Besides building more stations, what else could shorten the wait for help?'],
  },
  {
    id: 'five-oclock',
    icon: 'clock',
    title: 'Why is five o’clock so slow?',
    blurb: 'Roads that are empty at 3 a.m. crawl by late afternoon. The simulation sends about 780,000 car and truck trips through a school day, so you can watch the rush build and find out where it bites.',
    minutes: 15,
    skills: ['Reading charts', 'Models', 'Cause and effect'],
    predict: {
      prompt: 'On a school day, when do you think the most vehicles are on Buncombe County roads at once?',
      choices: ['Around 8 a.m.', 'Around noon', 'Around 5 p.m.', 'About the same all day'],
      text: 'What makes you think so?',
    },
    steps: [
      { title: 'Look at the whole day', say: 'Ask when traffic is worst. The chart on the answer card shows how many vehicles are moving in each hour.', button: 'Ask when traffic is worst', ask: 'When is traffic the worst?',
        notice: 'The line has two bumps. Why might the afternoon bump be wider than the morning one?' },
      { title: 'Watch the afternoon rush', say: 'Jump the clock to 5:15 p.m. Give the roads a few seconds to fill, then find where traffic is slowest.', button: 'Find the slowest roads', ask: 'Where is traffic worst right now?',
        setup: { label: 'Jump to 5:15 p.m. on a school day', scenario: 'weekday', hour: 17.25, roads: 'congestion', toast: 'The clock is at 5:15 p.m. Give the roads a few seconds to fill.' },
        notice: 'Which kinds of roads are red? Where are they taking people?' },
      { title: 'Measure one trip', say: 'A drive time is a number you can compare. Ask about one commute at 5:30 p.m.', button: 'Ask about this trip', ask: 'How long does it take to drive from {pick} to downtown at 5:30 pm?',
        pick: ['Weaverville', 'Black Mountain', 'Arden', 'Leicester'],
        notice: 'Which is slower for this trip, 8 a.m. or 5:30 p.m.? Why might that be?',
        check: { q: 'How many minutes does the afternoon rush add? Subtract the no-traffic time from the 5:30 p.m. time.', ask: 'How long does it take to drive from {pick} to downtown at 5:30 pm?', show: 'rows', rows: ['No traffic', '5:30 p.m. school day'] } },
      { title: 'Change the day', say: 'A model lets you run a day that has not happened. Switch to a snow day: schools are closed and everyone drives slower.', button: 'Switch to a snow day', ask: 'What happens to traffic on a snow day?',
        notice: 'What changed? What stayed the same?',
        tools: [{ label: 'Back to a school day', ask: 'What happens on a normal school day?' }] },
      { title: 'Find the busiest road', say: 'State traffic counters in the pavement count every vehicle that passes. This number is measured, not simulated.', button: 'Ask which road is busiest', ask: 'Which road is the busiest?',
        notice: 'Is the busiest road also where the simulation showed the worst jams?' },
    ],
    findings: [{ label: 'Slowest time on a simulated school day', ask: 'When is traffic the worst?' }],
    limit: 'The traffic here is a model of a typical day. It has no crashes, no road work and no surprise storms, and it can’t show buses, bikes or people walking.',
    extend: ['What does a Saturday look like?', 'How is traffic on Patton Avenue?', 'Where do the most people have long commutes?'],
    discuss: ['Schools let out before most workplaces do. How does that shape the afternoon rush?', 'If you could change one thing to ease the 5 p.m. rush, what would it be? How could you test the idea in a model?', 'The simulation shows a typical day. What kinds of days would it get wrong?'],
  },
  {
    id: 'kids-schools',
    icon: 'school',
    title: 'Where do the county’s kids live, and where are the schools?',
    blurb: 'Schools have to be near kids, but kids are not spread evenly across the county. Put the two maps on top of each other and see how well they match.',
    minutes: 15,
    skills: ['Reading maps', 'Share vs. count', 'Fair comparisons'],
    predict: {
      prompt: 'Where do you think kids and teens make up the biggest share of the people who live there?',
      choices: ['Downtown Asheville', 'Neighborhoods close to downtown', 'Suburbs and small towns', 'The most rural corners'],
      text: 'Why there?',
    },
    steps: [
      { title: 'Map the kids', say: 'Color every neighborhood by the share of residents who are under 18. The pins mark the top three.', button: 'Ask where the kids live', ask: 'Where do the most kids live?',
        notice: 'Are the top areas close together or scattered? Close to downtown or far from it?',
        check: { q: 'What share of everyone in Buncombe County is under 18?', ask: 'What is the share of residents under 18 in Buncombe County?', show: 'headline' } },
      { title: 'Add the schools', say: 'Count the schools. They appear as pins on top of the kids map.', button: 'Show the schools', ask: 'How many schools are there?', then: { layer: 'pct_under_18' },
        notice: 'Do the school pins sit where the map is brightest? Find a bright area with no school nearby.',
        check: { q: 'How many students do all the listed schools enroll together?', ask: 'How many students are there?', show: 'headline' } },
      { title: 'How far is school?', say: 'Pick a community and find its closest school by road.', button: 'Find the closest school', ask: 'What is the closest school to {pick}?',
        pick: ['Leicester', 'Barnardsville', 'Black Mountain', 'West Asheville', 'Arden'],
        notice: 'How long is the drive? What would that mean for a bus route?' },
      { title: 'Which school goes with which home?', say: 'Public schools have attendance zones. Pick a place and see the schools it is zoned for.', button: 'Look up the zone', ask: 'Which school is {pick} zoned for?',
        pick: ['Montford', 'Arden', 'Leicester', 'Swannanoa', 'Fairview'],
        notice: 'Is the zoned school always the closest one? Why might it not be?' },
      { title: 'Compare the towns', say: 'Now rank the towns instead of the neighborhoods.', button: 'Ask which town', ask: 'Which town has the most kids and teens?',
        notice: 'Did a town come out on top, or was the pattern clearer at the neighborhood level?' },
    ],
    findings: [
      { label: 'Area with the largest share of kids and teens', ask: 'Where do the most kids live?' },
      { label: 'Town with the largest share', ask: 'Which town has the most kids and teens?' },
    ],
    limit: 'The kids map shows a share, from a survey. A place can have a high share and still have few kids if few people live there. And the map can’t tell you which school any one student attends.',
    extend: ['Where do the most older adults live?', 'Where do the biggest households live?', 'Which town has the youngest residents?'],
    discuss: ['Why is “share of residents under 18” different from “number of kids”? When would each one matter?', 'If the county could open one new school, what would you want to know before choosing a site?', 'Attendance zones are lines drawn by people. Who should get a say in where they go?'],
  },
  {
    id: 'reach-er',
    icon: 'cross',
    title: 'Who can reach an emergency room in 15 minutes?',
    blurb: 'Mission Hospital in Asheville has the only top-level trauma center in Western North Carolina. For people in the far corners of the county, getting there takes time.',
    minutes: 15,
    skills: ['Reading maps', 'Rates and shares', 'Models'],
    predict: {
      prompt: 'What share of the county’s people do you think live within a 15-minute drive of Mission Hospital?',
      choices: ['About a quarter', 'About half', 'About three quarters', 'Almost everyone'],
      text: 'What did you base your guess on?',
    },
    steps: [
      { title: 'Find the hospitals', say: 'Count the hospitals and see which ones have an emergency room open around the clock.', button: 'Show the hospitals', ask: 'How many hospitals are there?',
        notice: 'Where are the emergency rooms? Which parts of the county have none close by?' },
      { title: 'Draw the 15-minute line', say: 'Ask how many people live within a 15-minute drive of Mission Hospital. Colors show the drive time: green is close, red is far.', button: 'Ask who is within 15 minutes', ask: 'How many people live within 15 minutes of Mission Hospital?',
        notice: 'The green area is not a circle. Why does it stretch farther in some directions?',
        check: { q: 'How does the number change if you allow 30 minutes?', ask: 'How many people live within 30 minutes of Mission Hospital?', show: 'sub' } },
      { title: 'Check the edges', say: 'Pick a community and find its closest emergency room.', button: 'Find the closest ER', ask: 'How far is the nearest emergency room from {pick}?',
        pick: ['Black Mountain', 'Leicester', 'Barnardsville', 'Weaverville', 'Fairview'],
        notice: 'How long is the drive? Which emergency room is it?' },
      { title: 'Add rush hour', say: 'An emergency doesn’t wait for traffic to clear. Ask about one trip at 5:30 p.m.', button: 'Ask about this trip', ask: 'How long does it take to drive from Barnardsville to Mission Hospital at 5:30 pm?',
        notice: 'How much time does rush hour add to this trip?' },
      { title: 'Count both halves', say: 'A trip to the ER by ambulance has two parts: the ambulance coming to you, then the ride to the hospital.', button: 'Ask how fast help arrives', ask: 'How fast can an ambulance get to Barnardsville?',
        notice: 'Add the two parts together. About how long from the 911 call to the hospital door?' },
    ],
    findings: [{ label: 'Within a 15-minute drive of Mission Hospital', ask: 'How many people live within 15 minutes of Mission Hospital?', show: 'sub' }],
    limit: 'Drive times assume you have a car and the roads are open. The map can show where many households have no car, but it has no bus routes, and it can’t tell who is able to get a ride.',
    extend: ['Where do the most households have no car?', 'Where do the most older adults live?', 'Where should a new ambulance base go?'],
    discuss: ['Why is the 15-minute area stretched along highways instead of round?', 'Who is most affected by living far from an emergency room? What else, besides distance, decides whether someone gets care in time?', 'Hospitals are expensive to build. How should a region decide where they go?'],
  },
  {
    id: 'big-event',
    icon: 'star',
    title: 'What does a big event do to a city?',
    blurb: 'A ballgame, a fireworks show, a weekend of fall color: each one puts thousands of extra trips on the same roads people use every day. Run three kinds of event and compare.',
    minutes: 20,
    skills: ['Models', 'Cause and effect', 'Comparing cases'],
    predict: {
      prompt: 'About 3,000 fans head to the Asheville Tourists’ ballpark for a Friday night game. What do you expect to see?',
      choices: ['Jams across the whole city', 'Slow streets near the ballpark only', 'Hardly any difference'],
      text: 'What is your reasoning?',
    },
    steps: [
      { title: 'Game night', say: 'Switch the simulation to a game night. It starts in the late afternoon; first pitch is 6:35 p.m. Speed up time and watch the streets around the ballpark.', button: 'Switch to game night', ask: 'What happens when there is a baseball game?',
        tools: [{ label: 'Speed up time (60×)', speed: 60 }, { label: 'Jump to 6 p.m.', hour: 18, toast: 'The clock is at 6 p.m. Give the roads a few seconds to fill.' }],
        notice: 'What happens near the ballpark as 6:35 p.m. gets close? Does it spread?' },
      { title: 'Measure it', say: 'When the clock is past 6 p.m., ask where traffic is slowest. The fans arrive on top of the evening rush.', button: 'Find the slowest roads', ask: 'Where is traffic worst right now?',
        notice: 'Are the slowest roads near the ballpark, or are they the same roads that are slow every evening?' },
      { title: 'A much bigger crowd', say: 'On July 4th a crowd gathers downtown for fireworks, and then everyone leaves at once.', button: 'Switch to July 4th', ask: 'What happens on July 4th?',
        tools: [{ label: 'Jump to 9:45 p.m.', hour: 21.75, toast: 'The clock is at 9:45 p.m., just before the fireworks end.' }, { label: 'Speed up time (60×)', speed: 60 }],
        notice: 'People arrive over a few hours but leave in a few minutes. How does that change the traffic?' },
      { title: 'An event with no single place', say: 'Leaf season brings visitors to many spots at once: the Blue Ridge Parkway, the Biltmore gate, downtown.', button: 'Switch to leaf season', ask: 'What happens during leaf season?',
        tools: [{ label: 'Jump to 1 p.m.', hour: 13, toast: 'The clock is at 1 p.m.' }, { label: 'Speed up time (60×)', speed: 60 }],
        notice: 'Where do the visitors go? Which roads carry them in?' },
      { title: 'Back to an ordinary day', say: 'Return to a normal school day so you have something to compare against.', button: 'Switch to a school day', ask: 'What happens on a normal school day?',
        notice: 'Which event changed the city the most? What would you measure to prove it?' },
    ],
    findings: [],
    limit: 'Crowd sizes for some events are estimates, and a model only shows what it was built to include. Real events also bring closed streets, shuttles and officers directing traffic.',
    extend: ['What happens on Black Friday?', 'How many visitors come to Asheville?', 'How many people live within 10 minutes of downtown?'],
    discuss: ['Why can a crowd leaving cause more trouble than the same crowd arriving?', 'Who benefits from big events, and who pays the costs?', 'What would you add to the model to make it more realistic?'],
  },
  {
    id: 'many-places',
    icon: 'towns',
    title: 'One county, many places: how different are our towns?',
    blurb: 'Buncombe County has one city, several small towns and a handful of communities the Census reports on. They share a county, but they are not alike.',
    minutes: 15,
    skills: ['Median and spread', 'Fair comparisons', 'Margin of error'],
    predict: {
      prompt: 'Which of these do you think has the highest median household income?',
      choices: ['Asheville', 'Black Mountain', 'Weaverville', 'Biltmore Forest'],
      text: 'What do you think makes one town different from another?',
    },
    steps: [
      { title: 'Size them up', say: 'Start with the simplest comparison: how many people live in each place.', button: 'Rank the towns by people', ask: 'Which town has the most people?',
        notice: 'How big is the gap between first place and second?',
        check: { q: 'What share of the whole county lives in Asheville?', ask: 'How many people live in Asheville?', show: 'rows', rows: ['Share of Buncombe County'] } },
      { title: 'Put two side by side', say: 'A comparison table lines up the same measures for two places.', button: 'Compare two towns', ask: 'Compare Weaverville and Black Mountain',
        notice: 'Which rows are nearly the same? Which are far apart?' },
      { title: 'Rank by income', say: 'Median household income is the income in the middle: half of households earn more and half earn less.', button: 'Rank the towns by income', ask: 'Which town has the highest household income?',
        notice: 'How does the top town compare with the bottom one?',
        check: { q: 'How does Asheville’s median compare with North Carolina’s and the whole country’s?', ask: 'What is the median income in Asheville?', show: 'rows', rows: ['Asheville', 'North Carolina', 'United States'] } },
      { title: 'A surprise', say: 'Ask which town has the youngest residents.', button: 'Rank the towns by age', ask: 'Which town has the youngest residents?',
        notice: 'What could explain a very young median age in a very small town? Look at the map for a clue.' },
      { title: 'Get to know one place', say: 'Pick a community and read its profile.', button: 'Tell me about it', ask: 'Tell me about {pick}',
        pick: ['Woodfin', 'Swannanoa', 'Fairview', 'Emma', 'Royal Pines'],
        notice: 'Write two ways this place is different from Asheville.' },
    ],
    findings: [
      { label: 'Highest median household income', ask: 'Which town has the highest household income?' },
      { label: 'Most people', ask: 'Which town has the most people?' },
    ],
    limit: 'A median describes the middle of a town, not everyone in it. Two towns with the same median can be very different inside. And in a small town the survey reaches only a few homes, so its estimates can be off by a lot.',
    extend: ['Compare Asheville and Biltmore Forest', 'Which town has the highest rent?', 'Where are the oldest homes?'],
    discuss: ['What does a median hide? Describe two very different towns that could share the same median income.', 'Town lines were drawn long ago. How might a line on a map change the numbers on each side of it?', 'Which comparison surprised you, and what would you want to find out next?'],
  },
  {
    id: 'go-together',
    icon: 'scatter',
    title: 'Do these two things go together?',
    blurb: 'When two measures rise and fall together across neighborhoods, there is a pattern. Whether one causes the other is a harder question, and a more interesting one.',
    minutes: 15,
    skills: ['Scatter plots', 'Correlation', 'Cause vs. correlation'],
    predict: {
      prompt: 'Do you think neighborhoods with higher incomes also have more adults with college degrees?',
      choices: ['Yes, strongly', 'Yes, a little', 'No pattern', 'The opposite'],
      text: 'Why might that be?',
    },
    steps: [
      { title: 'Plot the first pair', say: 'Each dot on the chart is one neighborhood area. The number r tells how tightly the dots follow a line: near 1 or -1 is tight, near 0 is no pattern.', button: 'Plot income and degrees', ask: 'Is income related to college degrees?',
        notice: 'Do the dots make a line, a cloud, or something in between? Find a dot that breaks the pattern.' },
      { title: 'A second pair', say: 'Now renters and households without a car.', button: 'Plot renters and cars', ask: 'Do places with more renters have more households without a car?',
        notice: 'Is this pattern stronger or weaker than the first? How can you tell from r?' },
      { title: 'Predict, then check', say: 'Before you press the button, decide: will rent and household income show a stronger or weaker pattern than the first two?', button: 'Plot rent and income', ask: 'Is rent related to household income?',
        notice: 'Were you right? What does the chart show?' },
      { title: 'Which way does it slope?', say: 'Some pairs move in opposite directions: when one is high, the other tends to be low.', button: 'Plot age and renters', ask: 'Is median age related to renters?',
        notice: 'Which way does this one slope? What would a negative r mean in plain words?' },
      { title: 'Think about cause', say: 'Renting a home does not make anyone give up a car. Look at where the renters live.', button: 'Map the renters', ask: 'Where do the most renters live?',
        notice: 'What else is true of those places that could explain both renting and having no car?' },
    ],
    findings: [
      { label: 'Income and college degrees', ask: 'Is income related to college degrees?', show: 'both' },
      { label: 'Renters and households without a car', ask: 'Do places with more renters have more households without a car?', show: 'both' },
    ],
    limit: 'Each dot is an area with hundreds or thousands of people, not a person. A pattern across areas can’t tell you about any one household, and it can’t prove that one thing causes the other.',
    extend: ['Are long commutes related to people per square mile?', 'Where do the most households have no car?', 'Where are the most apartments?'],
    discuss: ['Give an example of two things that go together without one causing the other. What is the hidden third thing?', 'Why is it a mistake to use a neighborhood pattern to guess something about one family?', 'How would you design a study that could test for cause?'],
  },
  {
    id: 'mountains',
    icon: 'mountain',
    title: 'How do mountains shape a city?',
    blurb: 'Asheville sits in a river valley with ridges on every side. The land decides where roads can go, and the roads decide a lot about where people live.',
    minutes: 15,
    skills: ['Reading terrain', 'Distance and scale', 'Geography'],
    predict: {
      prompt: 'Barnardsville and Black Mountain are both in the county’s eastern mountains. How do you think the distance by road compares with the straight-line distance?',
      choices: ['About the same', 'About one and a half times as far', 'More than twice as far'],
      text: 'What would make a road longer than a straight line?',
    },
    steps: [
      { title: 'Find the top and the bottom', say: 'Ask for the highest ground in the county.', button: 'Find the highest point', ask: 'What is the highest point in Buncombe County?',
        notice: 'Where is it? What is the land around it like?',
        check: { q: 'Where would you expect the lowest point to be? Decide, then check.', ask: 'What is the lowest point in Buncombe County?', show: 'sub' } },
      { title: 'How high are the towns?', say: 'Pick a place and ask how high it sits.', button: 'Ask how high', ask: 'How high is {pick}?',
        pick: ['downtown Asheville', 'Black Mountain', 'Montreat', 'Barnardsville', 'Weaverville'],
        notice: 'Try two or three places. Do the towns sit on high ground or low ground?' },
      { title: 'Straight line vs. road', say: 'Ask for the drive between two mountain communities. The answer card gives the distance by road and in a straight line.', button: 'Ask about this drive', ask: 'How long does it take to drive from Barnardsville to Black Mountain?',
        notice: 'Follow the yellow route on the map. Why does it go the way it does?',
        check: { q: 'How many times longer is the road than the straight line? Divide one by the other.', ask: 'How long does it take to drive from Barnardsville to Black Mountain?', show: 'rows', rows: ['Distance by road', 'Straight-line distance'] } },
      { title: 'Where people crowd together', say: 'Color the map by people per square mile, then tilt the view to see the land underneath.', button: 'Map where it is crowded', ask: 'Where are the most people per square mile?',
        tools: [{ label: 'Tilt to a 3D view', view: 'orbit' }],
        notice: 'Is the land under the crowded areas flat or steep? Near rivers or up on ridges?' },
      { title: 'Where almost no one lives', say: 'Now the opposite end of the scale.', button: 'Map where it is empty', ask: 'Where are the fewest people per square mile?',
        tools: [{ label: 'Tilt to a 3D view', view: 'orbit' }],
        notice: 'What is the land like there? Who might own it?' },
    ],
    findings: [{ label: 'Barnardsville to Black Mountain', ask: 'How long does it take to drive from Barnardsville to Black Mountain?', show: 'rows', rows: ['Distance by road', 'Straight-line distance'] }],
    limit: 'Elevation comes from a grid with one point every 30 meters, so sharp peaks are smoothed. And the map shows where people live now, not why they settled there. For that you need history.',
    extend: ['How many miles of road are there?', 'Where are the oldest homes?', 'How many people live within 10 minutes of downtown?'],
    discuss: ['Why do the main roads and the biggest towns follow the rivers?', 'How might living in a narrow valley change everyday life compared with living on open, flat land?', 'What are the trade-offs of building homes on steep slopes?'],
  },
  {
    id: 'next-station',
    icon: 'flame',
    title: 'Where should the next fire station go?',
    blurb: 'A design challenge. National guidelines aim for the first fire engine to arrive within 4 minutes of driving. You get one new station. Where does it do the most good?',
    minutes: 20,
    skills: ['Design under limits', 'Measuring a change', 'Trade-offs'],
    predict: {
      prompt: 'Before you look at any data: where would you put one new fire station?',
      choices: ['In the most crowded part of Asheville', 'In a growing suburb', 'In a far rural corner'],
      text: 'What is your reason?',
    },
    steps: [
      { title: 'See what exists', say: 'Count the fire stations and look at how they are spread out.', button: 'Show the fire stations', ask: 'How many fire stations are there?',
        notice: 'Where are stations packed close together? Where are they far apart?' },
      { title: 'Measure today', say: 'Before you change anything, measure it. This is your baseline.', button: 'Measure the coverage', ask: 'What share of people can a fire truck reach in 4 minutes?',
        notice: 'Red and dark areas wait the longest. Do many people live there, or few?' },
      { title: 'Let the computer search', say: 'The search tests hundreds of sites on main roads and counts how many more people each would bring inside the time.', button: 'Search for the best site', ask: 'Where should a new fire station go?',
        notice: 'Is the best site where you predicted? What did the search count, and what did it leave out?' },
      { title: 'Build it and measure again', say: 'Add a station at the best site the search found, then measure the coverage again.', button: 'Build at the best site and measure', ask: 'What share of people can a fire truck reach in 4 minutes?', act: 'addBest',
        tools: [{ label: 'Remove the stations I added', act: 'clearStations' }],
        notice: 'How much did one station change the county-wide number? Is that more or less than you expected?' },
      { title: 'Try your own site', say: 'Remove the station, place one where you think it belongs, and measure. Press the first button, then click the map.', button: 'Measure my design', ask: 'What share of people can a fire truck reach in 4 minutes?',
        tools: [{ label: 'Place a station on the map', act: 'placeStation' }, { label: 'Remove the stations I added', act: 'clearStations' }],
        notice: 'Did your site beat the computer’s? What would make your site the better choice anyway?' },
    ],
    findings: [
      { label: 'Fire stations on the map', ask: 'How many fire stations are there?' },
      { label: 'Reached within 4 minutes of driving (counting any station you added)', ask: 'What share of people can a fire truck reach in 4 minutes?' },
    ],
    limit: 'The search only counts how many more people a station would reach in time. It knows nothing about cost, land, staffing, how often each area calls 911, or help from stations just across the county line.',
    extend: ['Where should a new ambulance base go?', 'How fast can a fire truck get to Barnardsville?', 'Where are the most people per square mile?'],
    discuss: ['Reaching the most people and reaching the people who wait longest are different goals. Which should matter more?', 'One station moved the county-wide number only a little. Does that mean it isn’t worth building?', 'What information would a real fire chief have that this model does not?'],
  },
  {
    id: 'visitors',
    icon: 'suitcase',
    title: 'What do millions of visitors mean for the people who live here?',
    blurb: 'Buncombe County had a record 13.9 million visitors in 2023, before Hurricane Helene cut travel in 2024. Visitors bring jobs and money. They also need roads, rooms and places to park.',
    minutes: 15,
    skills: ['Ratios', 'Reading maps', 'Weighing trade-offs'],
    predict: {
      prompt: 'For every person who lives in Buncombe County, how many visitors do you think come in a year?',
      choices: ['About 1', 'About 5', 'About 50', 'About 500'],
      text: 'How did you estimate?',
    },
    steps: [
      { title: 'Count the visitors', say: 'Start with the yearly total and compare it with the number of residents.', button: 'Ask how many visitors', ask: 'How many visitors come to Asheville?',
        notice: 'Who made this estimate? How do you think they counted?' },
      { title: 'Where visitors sleep', say: 'Map the hotels, motels and inns.', button: 'Show the hotels', ask: 'How many hotels are there?',
        notice: 'Where are the hotels clustered? Why there?' },
      { title: 'Homes that are not lived in year-round', say: 'Some homes are kept for vacations or occasional use. Map where they are.', button: 'Map the vacation homes', ask: 'Where are the most vacation homes?',
        notice: 'Are the vacation homes in the same places as the hotels?',
        check: { q: 'Which town has the largest share of vacation homes?', ask: 'Which town has the most vacation homes?', show: 'both' } },
      { title: 'The busiest weekend', say: 'Late October, when the leaves peak, is the busiest time of the year. Switch to it and watch.', button: 'Switch to leaf season', ask: 'What happens during leaf season?',
        tools: [{ label: 'Jump to 1 p.m.', hour: 13, toast: 'The clock is at 1 p.m.' }, { label: 'Speed up time (60×)', speed: 60 }],
        notice: 'Which roads do visitors and residents have to share?' },
      { title: 'Where the work is', say: 'Many visitor jobs are in hotels, restaurants and shops. Map where the county’s jobs are.', button: 'Map the jobs', ask: 'Where are the jobs?',
        notice: 'Do the job centers match where the hotels are?' },
    ],
    findings: [{ label: 'Visitors in a year', ask: 'How many visitors come to Asheville?', show: 'sub' }],
    limit: 'Visitor totals are estimates made by the tourism agency. The map has hotels but not restaurants, shops or vacation rentals by address, and it can’t say how visitors change rents or wages.',
    extend: ['Where is rent the highest?', 'What happens on Black Friday?', 'Where do the most renters live?'],
    discuss: ['Who gains the most from tourism here, and who carries the costs?', 'When a home becomes a vacation home, what changes for the neighborhood around it?', 'What would you want to measure to decide whether a place has “too many” visitors?'],
  },
  {
    id: 'how-we-know',
    icon: 'lens',
    title: 'How do we know what we know about a city?',
    blurb: 'Every number in Ask Asheville carries a label: Counted, Surveyed, Simulated or Measured. They are not equally sure. Learn to tell them apart and you will read every chart and news story more sharply.',
    minutes: 15,
    skills: ['Sources of data', 'Margin of error', 'Models'],
    predict: {
      prompt: 'Which kind of number would you trust the most?',
      choices: ['A count of everyone', 'A survey of some people', 'A computer model', 'A reading from an instrument'],
      text: 'Why that one?',
    },
    steps: [
      { title: 'Counted and surveyed', say: 'Ask how many people live in Asheville. The card shows two numbers for the same city, with different labels.', button: 'Ask about Asheville', ask: 'How many people live in Asheville?',
        notice: 'Why are the two numbers different? Which would you use, and for what?' },
      { title: 'A survey has a margin of error', say: 'Montreat has fewer than 1,000 residents. Ask for its median household income and read the margin of error.', button: 'Ask about Montreat', ask: 'What is the median income in Montreat?',
        notice: 'What range could the true value be in?',
        check: { q: 'Compare with Asheville. Whose margin of error is bigger, and why?', ask: 'What is the median income in Asheville?', show: 'sub' } },
      { title: 'Simulated', say: 'Ask for a drive time, then open “How do we know?” on the answer card.', button: 'Ask for a drive time', ask: 'How long does it take to drive from Black Mountain to downtown?',
        notice: 'What is the model built from? What could make a real trip different?' },
      { title: 'Measured', say: 'Counters in the pavement count every vehicle that passes.', button: 'Ask which road is busiest', ask: 'Which road is the busiest?',
        notice: 'What can a traffic counter tell you? What can’t it tell you?' },
      { title: 'Even a measurement has limits', say: 'Ask for the highest point, then read “Keep in mind” under “How do we know?”.', button: 'Ask for the highest point', ask: 'What is the highest point in Buncombe County?',
        notice: 'Why might the real peak be a little higher than this number?' },
    ],
    findings: [{ label: 'Asheville, counted in 2020', ask: 'How many people live in Asheville?' }],
    limit: 'Every number here was true for a certain time. The count is from 2020, the survey covers 2020 to 2024, and the traffic imitates a typical day. Before you lean on a number, ask how old it is.',
    extend: ['What is the median age in Montreat?', 'How many buildings are in Buncombe County?', 'When is traffic the worst?'],
    discuss: ['Rank the four kinds of number from most to least sure. Does your ranking depend on the question?', 'Why does a small town have a bigger margin of error than a city?', 'A model is never exactly right. When is it still worth using?'],
  },
  {
    id: 'my-corner',
    icon: 'home',
    title: 'What is my corner of the county like?',
    blurb: 'Turn the questions on a place you know well. To use your own starting point, click a building on the map and press “Make this my spot”. It is saved only in this browser.',
    minutes: 15,
    skills: ['Asking questions', 'Using evidence', 'Fair comparisons'],
    place: ['West Asheville', 'North Asheville', 'Black Mountain', 'Weaverville', 'Arden', 'Leicester', 'Swannanoa', 'Fairview'],
    predict: {
      prompt: 'Think about the place you chose. Write two things you believe are true about it: how long the drive to downtown is, how fast help would come, or how high it sits.',
      choices: [],
      text: 'I think…',
    },
    steps: [
      { title: 'Get the profile', say: 'Start with the basics: who lives around here, and what the homes are like.', button: 'Tell me about it', ask: 'Tell me about {place}',
        notice: 'Which number surprised you?' },
      { title: 'The drive downtown', say: 'Ask for the drive to downtown Asheville with and without traffic.', button: 'Ask about the drive', ask: 'How long does it take to drive from {place} to downtown?',
        notice: 'How much does rush hour add? Which roads does the route use?' },
      { title: 'School and hospital', say: 'Find the closest school by road.', button: 'Find the closest school', ask: 'What is the closest school to {place}?',
        notice: 'Is the closest school the one students here are zoned for?',
        check: { q: 'And the closest hospital?', ask: 'What is the closest hospital to {place}?', show: 'sub' } },
      { title: 'If you called 911', say: 'Ask how fast an ambulance could arrive.', button: 'Ask how fast help arrives', ask: 'How fast can an ambulance get to {place}?',
        notice: 'Is that inside the county’s goal of 8 minutes 59 seconds?' },
      { title: 'How high is it?', say: 'Ask for the elevation and compare it with downtown.', button: 'Ask how high', ask: 'How high is {place}?',
        notice: 'Is it higher or lower than downtown Asheville? Does that match what you see out the window?' },
    ],
    findings: [
      { label: 'Drive to downtown Asheville', ask: 'How long does it take to drive from {place} to downtown?' },
      { label: 'Ambulance after a 911 call', ask: 'How fast can an ambulance get to {place}?' },
    ],
    limit: 'Neighborhoods have no official edges, so “the area around” a place is a circle on the map, not a boundary. And numbers can’t tell you what it feels like to live somewhere. For that you have to talk to people.',
    extend: ['Which school is {place} zoned for?', 'How many people live within 10 minutes of {place}?', 'Where do the most kids live?'],
    discuss: ['What did the numbers get right about a place you know? What did they miss?', 'If a stranger read only these numbers, what wrong idea might they get about your part of the county?', 'What question about your place could no data set answer?'],
  },
];

// --- The guide ---------------------------------------------------------------------------------

const KEY = 'ask-asheville:guide:v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  siren: '<path d="M6.5 18v-5.5a5.5 5.5 0 0 1 11 0V18"/><path d="M4.5 18h15v2.5h-15z"/><path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2.2"/>',
  school: '<path d="M3 9.5L12 5l9 4.5L12 14z"/><path d="M7 11.7V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.3"/>',
  cross: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8v8M8 12h8"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  towns: '<path d="M3 20h18"/><path d="M5 20v-8l3.5-2.5L12 12v8"/><path d="M12 20v-11l3.5-2.5L19 9v11"/>',
  scatter: '<path d="M4 4v16h16"/><circle cx="8" cy="15" r="1.1"/><circle cx="11" cy="12.5" r="1.1"/><circle cx="13.5" cy="13.5" r="1.1"/><circle cx="15.5" cy="9" r="1.1"/><circle cx="18" cy="7" r="1.1"/>',
  mountain: '<path d="M2.5 19l6.5-11 4 6.5 2.5-3.5 6 8z"/><path d="M7.4 10.7l1.6 1.6 1.4-1.9"/>',
  flame: '<path d="M12 3c.6 3 4.8 4.8 4.8 9.6a4.8 4.8 0 0 1-9.6 0c0-1.9.9-3.3 1.9-4.3 0 1.9 1 2.9 1.9 2.9 0-2.9-1-4.8 1-8.2z"/>',
  suitcase: '<rect x="4" y="8" width="16" height="11.5" rx="2"/><path d="M9 8V6.2A1.2 1.2 0 0 1 10.2 5h3.6A1.2 1.2 0 0 1 15 6.2V8"/><path d="M4 13h16"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path d="M8 10.7l1.8 1.8 3-3.4"/>',
  home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6 10.5V19h12v-8.5"/><path d="M10 19v-5h4v5"/>',
};
const icon = (k) => `<svg class="gd-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ICONS.lens}</svg>`;

export class Guide {
  constructor(ui) {
    this.ui = ui;
    this.active = null; // the open investigation (an INVESTIGATIONS entry) or null
    this.state = { v: 1, inv: {} };
    this.memoryOnly = false;
    this._saveTimer = 0;
    this.load();
    // Styles, if the page has not linked them itself.
    if (typeof document !== 'undefined' && !document.querySelector('link[href*="guide.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./guide.css', import.meta.url).href;
      document.head.appendChild(link);
    }
  }

  // --- State ---------------------------------------------------------------------------------------

  load() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.v === 1 && o.inv && typeof o.inv === 'object') this.state = o;
    } catch {
      this.memoryOnly = true;
    }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      this.memoryOnly = true; // keep working in memory
    }
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 400);
  }

  /** Saved progress for one investigation. */
  st(inv = this.active) {
    const all = this.state.inv;
    if (!all[inv.id] || typeof all[inv.id] !== 'object') all[inv.id] = {};
    const s = all[inv.id];
    s.stage = Number.isInteger(s.stage) ? Math.max(0, Math.min(inv.steps.length + 2, s.stage)) : 0;
    s.choice = typeof s.choice === 'string' ? s.choice : '';
    s.text = typeof s.text === 'string' ? s.text : '';
    for (const k of ['notes', 'picks', 'ran', 'rev', 'ba']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    s.wonder = typeof s.wonder === 'string' ? s.wonder : '';
    return s;
  }

  currentTitle() {
    return this.active ? this.active.title : undefined;
  }

  /** The place a whole investigation is about ("my spot" when one is set). */
  placeOf(inv, s) {
    if (!inv.place) return '';
    const hasSpot = !!this.ui.lab.mySpot;
    if (s.place === 'my spot' && hasSpot) return 'my spot';
    if (s.place && s.place !== 'my spot' && inv.place.includes(s.place)) return s.place;
    return hasSpot && !s.place ? 'my spot' : inv.place[0];
  }

  fill(text, inv, s, i) {
    const step = i >= 0 ? inv.steps[i] : null;
    const pick = step && step.pick ? (step.pick.includes(s.picks[i]) ? s.picks[i] : step.pick[0]) : '';
    return String(text).replace(/\{pick\}/g, pick).replace(/\{place\}/g, this.placeOf(inv, s));
  }

  // --- Opening and moving ---------------------------------------------------------------------------

  open(id) {
    const inv = INVESTIGATIONS.find((x) => x.id === id);
    if (!inv) return false;
    // A fresh start: put away whatever answer and map colors were left from before.
    if (this.active !== inv && this.ui.answer) {
      try { this.ui.closeAnswer(); } catch { /* fine */ }
    }
    this.active = inv;
    this.st(inv);
    this._find = null;
    try { history.replaceState(null, '', `#i=${inv.id}`); } catch { /* fine */ }
    const hud = this.ui.app.hud;
    if (hud.tab === 'questions') hud.renderPanel(); else hud.openTab('questions');
    this.scrollTop();
    return true;
  }

  backToGallery() {
    this.active = null;
    this.save();
    try {
      if (location.hash.startsWith('#i=')) history.replaceState(null, '', location.pathname + location.search);
    } catch { /* fine */ }
    this.ui.app.hud.renderPanel();
    this.scrollTop();
  }

  go(stage) {
    const inv = this.active;
    if (!inv) return;
    const s = this.st();
    s.stage = Math.max(0, Math.min(inv.steps.length + 2, stage));
    if (s.stage === inv.steps.length + 2) s.done = true;
    this._find = null;
    this.save();
    this.redraw(false);
  }

  body() {
    return document.getElementById('panelBody');
  }

  scrollTop() {
    const b = this.body();
    if (b) b.scrollTop = 0;
  }

  /** Redraw the panel from state. keep = stay at the same scroll position. */
  redraw(keep = true) {
    const b = this.body();
    const top = b ? b.scrollTop : 0;
    const hud = this.ui.app.hud;
    if (hud.tab === 'questions') hud.renderPanel();
    const b2 = this.body();
    if (b2) b2.scrollTop = keep ? top : 0;
  }

  onAnswer() { /* answers shown from a step are tracked where they are asked */ }

  // --- Gallery ----------------------------------------------------------------------------------------

  renderGallery(el) {
    if (!el) return;
    const done = INVESTIGATIONS.filter((inv) => this.state.inv[inv.id]?.done).length;
    el.innerHTML = `<h3 class="eyebrow gd-gal-h">Investigations${done ? ` <span class="gd-gal-count">${done} of ${INVESTIGATIONS.length} done</span>` : ''}</h3>
      <div class="gd-gal">${INVESTIGATIONS.map((inv) => {
    const s = this.state.inv[inv.id] || {};
    const status = s.done ? '<span class="gd-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Done</span>' : s.stage > 0 ? '<span class="gd-going">In progress</span>' : '';
    return `<button type="button" class="gd-card${s.done ? ' is-done' : ''}" data-inv="${esc(inv.id)}">
          ${icon(inv.icon)}
          <span class="gd-card-main"><span class="gd-card-t">${esc(inv.title)}</span>
          <span class="gd-card-m"><span>${inv.minutes} min</span>${inv.skills.slice(0, 2).map((k) => `<span>${esc(k)}</span>`).join('')}${status}</span></span></button>`;
  }).join('')}</div>`;
    for (const b of el.querySelectorAll('.gd-card')) b.addEventListener('click', () => this.open(b.dataset.inv));
  }

  // --- One stage of an investigation ---------------------------------------------------------------------

  renderStep(body) {
    const inv = this.active;
    if (!inv || !body) return;
    const s = this.st();
    const n = inv.steps.length;
    const stages = n + 3; // predict, n steps, explain, go further
    const stage = s.stage;
    const name = stage === 0 ? 'Predict' : stage <= n ? `Explore ${stage} of ${n}` : stage === n + 1 ? 'Explain' : 'Go further';
    const dots = Array.from({ length: stages }, (_, k) => {
      const lab = k === 0 ? 'Predict' : k <= n ? `Explore step ${k}` : k === n + 1 ? 'Explain' : 'Go further';
      const visited = k < stage || (k >= 1 && k <= n && s.ran[k - 1]);
      return `<li><button type="button" class="gd-dot${k === stage ? ' is-on' : ''}${visited ? ' is-seen' : ''}" data-go="${k}" aria-label="${esc(lab)}"${k === stage ? ' aria-current="step"' : ''}></button></li>`;
    }).join('');
    let html;
    if (stage === 0) html = this.predictHtml(inv, s);
    else if (stage <= n) html = this.exploreHtml(inv, s, stage - 1);
    else if (stage === n + 1) html = this.explainHtml(inv, s);
    else html = this.extendHtml(inv, s);
    const canNext = stage > 0 || s.choice || s.text.trim().length >= 3;
    const nextLabel = stage === 0 ? 'Start exploring' : stage < n ? 'Next step' : stage === n ? 'Explain what you found' : stage === n + 1 ? 'Finish' : '';
    body.innerHTML = `<div class="gd" data-inv="${esc(inv.id)}">
      <div class="gd-top">
        <button type="button" class="gd-back" id="gdBack"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg><span>All investigations</span></button>
        <span class="gd-where">${esc(name)}</span>
      </div>
      <h3 class="gd-title">${esc(inv.title)}</h3>
      <ol class="gd-dots" aria-label="Steps">${dots}</ol>
      <section class="gd-stage" aria-live="polite">${html}</section>
      <div class="gd-nav">
        ${stage > 0 ? '<button type="button" class="action" id="gdPrev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg><span>Back</span></button>' : '<span></span>'}
        ${nextLabel ? `<button type="button" class="gd-next" id="gdNext" ${canNext ? '' : 'disabled'}><span>${esc(nextLabel)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg></button>` : ''}
      </div>
      ${stage === 0 && !canNext ? '<p class="gd-hint" id="gdHint">Make a prediction to start. There are no wrong guesses: you will compare it with the data later. <button type="button" class="gd-link" id="gdSkip">Skip for now</button></p>' : ''}
    </div>`;
    this.bind(body, inv, s);
    if (stage === n + 1) this.fillFindings(inv, s);
  }

  predictHtml(inv, s) {
    const p = inv.predict;
    const place = inv.place ? this.placeOf(inv, s) : '';
    const hasSpot = !!this.ui.lab.mySpot;
    return `<p class="gd-blurb">${esc(inv.blurb)}</p>
      <p class="gd-meta"><span>${inv.minutes} minutes</span>${inv.skills.map((k) => `<span class="gd-tag">${esc(k)}</span>`).join('')}</p>
      ${inv.place ? `<div class="gd-box"><h4>Choose your place</h4>
        <div class="chips gd-chips" role="group" aria-label="Place to investigate">
          ${hasSpot ? `<button type="button" class="chip" data-place="my spot" aria-pressed="${place === 'my spot'}">My spot</button>` : ''}
          ${inv.place.map((x) => `<button type="button" class="chip" data-place="${esc(x)}" aria-pressed="${place === x}">${esc(x)}</button>`).join('')}
        </div>
        ${hasSpot ? '' : '<p class="note">To use your own starting point, click a building on the map (or search an address), then press “Make this my spot”. Then come back here.</p>'}</div>` : ''}
      <div class="gd-box gd-predict"><h4>Predict first</h4>
        <p>${esc(p.prompt)}</p>
        ${p.choices.length ? `<div class="chips gd-chips" role="group" aria-label="Your prediction">${p.choices.map((c) => `<button type="button" class="chip" data-choice="${esc(c)}" aria-pressed="${s.choice === c}">${esc(c)}</button>`).join('')}</div>` : ''}
        <label class="gd-lab" for="gdPredText">${esc(p.text)}</label>
        <textarea class="gd-ta" id="gdPredText" data-save="text" rows="2">${esc(s.text)}</textarea>
      </div>`;
  }

  exploreHtml(inv, s, i) {
    const step = inv.steps[i];
    const q = this.fill(step.ask, inv, s, i);
    const pick = step.pick ? (step.pick.includes(s.picks[i]) ? s.picks[i] : step.pick[0]) : '';
    const saved = this.ui.notebook.has(q);
    const tools = [...(step.setup ? [step.setup] : []), ...(step.tools || [])];
    const toolBtn = (t, k) => `<button type="button" class="action gd-tool" data-tool="${k}">${esc(t.label)}</button>`;
    const first = step.setup ? `<div class="gd-tools">${toolBtn(tools[0], 0)}</div>` : '';
    const rest = tools.map((t, k) => (step.setup && k === 0 ? '' : toolBtn(t, k))).join('');
    let reveal = '';
    if (step.check && s.rev[i]) reveal = this.revealHtml(inv, s, i);
    const ba = s.ba[i];
    // The answer in brief, for small screens where the panel covers the answer card.
    const cur = s.ran[i] && this.ui.answer && this.ui.answer.question === q ? this.ui.answer : null;
    const still = !(this.ui.app.world.scenarios || []).length;
    const asked = !s.ran[i] ? `This asks: “${esc(q)}”`
      : cur && cur.miss ? (still ? 'This step needs the moving traffic. Open the page without “?nosim” in the address to try it.' : 'That one could not be answered right now. Try typing it in the bar at the top.')
        : `Asked: “${esc(q)}” The answer and its evidence are on the answer card.`;
    const brief = cur && !cur.miss ? `<div class="gd-ans"><b>${esc(cur.headline)}</b><p>${esc(cur.sub)}</p><button type="button" class="action" id="gdPeek">Show the map and the full answer</button></div>` : '';
    return `<h4 class="gd-step-t">${esc(step.title)}</h4>
      <p>${esc(step.say)}</p>
      ${step.pick ? `<div class="chips gd-chips" role="group" aria-label="Choose a place">${step.pick.map((x) => `<button type="button" class="chip" data-pick="${esc(x)}" aria-pressed="${x === pick}">${esc(x)}</button>`).join('')}</div>` : ''}
      ${first}
      <button type="button" class="gd-run" id="gdRun"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg><span>${esc(step.button)}</span></button>
      ${rest ? `<div class="gd-tools">${rest}</div>` : ''}
      <p class="gd-asked${s.ran[i] ? '' : ' is-idle'}" id="gdAsked">${asked}</p>
      ${brief}
      ${ba ? `<p class="gd-ba"><span>Before: <b>${esc(ba.before)}</b></span><span>After: <b>${esc(ba.after)}</b></span></p>` : ''}
      <label class="gd-lab" for="gdNote">${esc(step.notice || 'What do you notice?')}</label>
      <textarea class="gd-ta" id="gdNote" data-note="${i}" rows="3" placeholder="Write what you see.">${esc(s.notes[i] || '')}</textarea>
      ${step.check ? `<div class="gd-check"><h5>Check your reading</h5><p>${esc(this.fill(step.check.q, inv, s, i))}</p>
        ${s.rev[i] ? `<div class="gd-reveal">${reveal}</div>` : '<button type="button" class="action" id="gdReveal">Show the answer</button>'}</div>` : ''}
      <button type="button" class="action gd-save" id="gdSave" ${saved ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/></svg><span>${saved ? 'Evidence saved to notebook' : 'Save this evidence'}</span></button>`;
  }

  /** The live answer behind a "check your reading" item. */
  revealHtml(inv, s, i) {
    const c = inv.steps[i].check;
    let a = null;
    try { a = this.ui.asker.ask(this.fill(c.ask, inv, s, i)); } catch { a = null; }
    if (!a || a.miss) return '<p>That one could not be worked out right now. Try asking it in the bar at the top.</p>';
    return this.pickHtml(a, c);
  }

  /** Part of an answer, chosen by `show`: headline, sub, both, or named figure rows. */
  pickHtml(a, spec) {
    const show = spec.show || 'headline';
    if (show === 'rows') {
      const rows = (a.figures || []).filter((f) => (spec.rows || []).some((r) => f.label.toLowerCase().startsWith(r.toLowerCase()) || f.label.toLowerCase().includes(r.toLowerCase())));
      if (rows.length) return `<dl class="gd-kv">${rows.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>`;
      return `<p><b>${esc(a.headline)}</b></p>`;
    }
    if (show === 'sub') return `<p>${esc(a.sub)}</p>`;
    if (show === 'both') return `<p><b>${esc(a.headline)}.</b> ${esc(a.sub)}</p>`;
    return `<p><b>${esc(a.headline)}</b></p>`;
  }

  explainHtml(inv, s) {
    const p = inv.predict;
    const mine = [s.choice, s.text.trim()].filter(Boolean).join('. ');
    const cards = this.ui.notebook.cards.filter((c) => c.investigation === inv.title).length;
    const notes = inv.steps.map((st, i) => (s.notes[i] || '').trim()).filter(Boolean).length;
    return `<div class="gd-box"><h4>You predicted</h4>
        <p class="gd-q">${esc(p.prompt)}</p>
        <p class="gd-mine">${mine ? esc(mine) : 'You skipped the prediction. That’s fine: what did you expect before you started?'}</p>
        ${inv.findings.length ? `<h4>The data shows</h4><div id="gdFind" class="gd-find"><p class="note">Working it out…</p></div>` : ''}
        <p class="note">A prediction that turns out different from the data is useful. Say what you learned from the gap.</p></div>
      <div class="gd-box"><h4>Make a claim</h4>
        <p>Answer the big question in a sentence or two, and back it up with evidence you saved.</p>
        <ul class="gd-starters">${STARTERS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="note">${cards ? `You saved ${cards} evidence card${cards === 1 ? '' : 's'} in this investigation. Mark the ones you use with “Use as evidence”.` : 'You have not saved any evidence yet. Go back to a step and press “Save this evidence”.'}</p>
        <button type="button" class="gd-run" id="gdWrite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/><path d="M9 8.5h5"/></svg><span>Open my notebook to write it up</span></button>
        ${mine || notes ? `<button type="button" class="action" id="gdShare" ${s.shared ? 'disabled' : ''}>${s.shared ? 'Prediction and notes added to notebook' : 'Add my prediction and notes to my notebook'}</button>` : ''}</div>
      <div class="gd-box gd-limit"><h4>What can’t this data tell us?</h4>
        <p>${esc(inv.limit)}</p>
        <label class="gd-lab" for="gdWonder">What else would you need to find out, and who could you ask?</label>
        <textarea class="gd-ta" id="gdWonder" data-save="wonder" rows="2">${esc(s.wonder)}</textarea></div>`;
  }

  /** "The data shows": computed after the panel paints, so a slow search never blocks the page. */
  fillFindings(inv, s) {
    if (!inv.findings.length) return;
    const run = () => {
      const el = document.getElementById('gdFind');
      if (!el || this.active !== inv) return;
      if (!this._find) {
        this._find = inv.findings.map((f) => {
          let a = null;
          try { a = this.ui.asker.ask(this.fill(f.ask, inv, s, -1)); } catch { a = null; }
          return { f, a };
        });
      }
      el.innerHTML = this._find.map(({ f, a }) => `<div class="gd-find-row"><span class="gd-find-l">${esc(f.label)}</span>${a && !a.miss ? this.pickHtml(a, f) : '<p>Not available right now.</p>'}</div>`).join('');
    };
    if (this._find) run(); else setTimeout(run, 40);
  }

  extendHtml(inv, s) {
    const left = INVESTIGATIONS.filter((x) => !this.state.inv[x.id]?.done && x.id !== inv.id);
    const next = left[0];
    return `<div class="gd-box gd-finish"><h4>You worked through the whole question</h4>
        <p>Good investigations end with new questions. Try one of these, or ask your own.</p>
        <div class="gd-follow">${inv.extend.map((x) => `<button type="button" class="follow" data-q="${esc(this.fill(x, inv, s, -1))}">${esc(this.fill(x, inv, s, -1))}</button>`).join('')}</div>
        <div class="gd-tools">
          <button type="button" class="action" id="gdOwn">Ask my own question</button>
          <button type="button" class="action" id="gdWrite">Open my notebook</button>
        </div></div>
      ${next ? `<div class="gd-box"><h4>Next investigation</h4><button type="button" class="gd-card" data-inv="${esc(next.id)}">${icon(next.icon)}<span class="gd-card-main"><span class="gd-card-t">${esc(next.title)}</span><span class="gd-card-m"><span>${next.minutes} min</span>${next.skills.slice(0, 2).map((k) => `<span>${esc(k)}</span>`).join('')}</span></span></button></div>` : '<div class="gd-box"><h4>You have finished every investigation</h4><p>Now write your own. A good question names a place, something you can measure, and a comparison.</p></div>'}`;
  }

  // --- Wiring ---------------------------------------------------------------------------------------------

  bind(body, inv, s) {
    const ui = this.ui;
    const $ = (id) => body.querySelector(`#${id}`);
    const n = inv.steps.length;
    const i = s.stage - 1;
    $('gdBack')?.addEventListener('click', () => this.backToGallery());
    $('gdPrev')?.addEventListener('click', () => this.go(s.stage - 1));
    $('gdNext')?.addEventListener('click', () => this.go(s.stage + 1));
    $('gdSkip')?.addEventListener('click', () => this.go(1));
    for (const b of body.querySelectorAll('.gd-dot')) b.addEventListener('click', () => this.go(Number(b.dataset.go)));
    for (const b of body.querySelectorAll('.gd-card')) b.addEventListener('click', () => this.open(b.dataset.inv));
    // Typing saves without redrawing, so the cursor never jumps.
    for (const ta of body.querySelectorAll('.gd-ta')) {
      ta.addEventListener('input', () => {
        if (ta.dataset.note !== undefined) s.notes[ta.dataset.note] = ta.value;
        else if (ta.dataset.save) s[ta.dataset.save] = ta.value;
        this.saveSoon();
        if (ta.dataset.save === 'text') {
          const ok = !!s.choice || s.text.trim().length >= 3;
          const next = $('gdNext');
          if (next) next.disabled = !ok;
          const hint = $('gdHint');
          if (hint) hint.hidden = ok;
        }
      });
      ta.addEventListener('blur', () => this.save());
    }
    for (const b of body.querySelectorAll('[data-choice]')) {
      b.addEventListener('click', () => {
        s.choice = s.choice === b.dataset.choice ? '' : b.dataset.choice;
        this.save();
        this.redraw();
      });
    }
    for (const b of body.querySelectorAll('[data-place]')) {
      b.addEventListener('click', () => {
        s.place = b.dataset.place;
        s.ran = {}; s.rev = {};
        this.save();
        this.redraw();
      });
    }
    for (const b of body.querySelectorAll('[data-pick]')) {
      b.addEventListener('click', () => {
        s.picks[i] = b.dataset.pick;
        s.ran[i] = false; s.rev[i] = false;
        this.save();
        this.redraw();
      });
    }
    if (s.stage >= 1 && s.stage <= n) {
      const step = inv.steps[i];
      const tools = [...(step.setup ? [step.setup] : []), ...(step.tools || [])];
      for (const b of body.querySelectorAll('.gd-tool')) b.addEventListener('click', () => this.runTool(tools[Number(b.dataset.tool)], inv, s, i));
      $('gdRun')?.addEventListener('click', () => this.runStep(inv, s, i));
      $('gdReveal')?.addEventListener('click', () => { s.rev[i] = true; this.save(); this.redraw(); });
      $('gdSave')?.addEventListener('click', () => this.saveEvidence(inv, s, i));
      // Close the panel to see the map; the Questions button brings this step back.
      $('gdPeek')?.addEventListener('click', () => {
        ui.app.hud.openTab(null);
        ui.app.hud.toast('To come back to this step, press Questions. If the button is hidden, close the answer card first.', 6000);
      });
    }
    for (const b of body.querySelectorAll('.gd-follow .follow')) b.addEventListener('click', () => ui.ask(b.dataset.q, { quiet: true, from: 'guide' }));
    $('gdOwn')?.addEventListener('click', () => { const inp = document.getElementById('askInput'); if (inp) { inp.value = ''; inp.focus(); } });
    for (const b of body.querySelectorAll('#gdWrite')) b.addEventListener('click', () => this.openNotebook(inv));
    $('gdShare')?.addEventListener('click', () => this.shareNotes(inv, s));
  }

  /** A small button beside the main one: change the day, the clock, the speed, the view, or run an action. */
  async runTool(t, inv, s, i) {
    if (!t) return;
    const ui = this.ui;
    const view = ui.view;
    try {
      if (t.ask) {
        await ui.ask(this.fill(t.ask, inv, s, i), { quiet: true, from: 'guide' });
      } else if (t.act) {
        this.act(t.act);
        if (t.act === 'clearStations' && s.ba[i]) { delete s.ba[i]; this.save(); this.redraw(); }
      } else {
        if (t.scenario) view.scenario(t.scenario, t.hour ?? null);
        else if (t.hour !== undefined) view.hour(t.hour);
        if (t.roads) view.roads(t.roads);
        if (t.speed) ui.app.setSpeed(t.speed);
        if (t.view === 'orbit') view.orbit();
        if (t.view === 'top') view.top();
      }
    } catch (err) {
      console.error('Guide tool failed', err);
    }
    if (t.toast) ui.app.hud.toast(t.toast, 5000);
    else if (t.speed) ui.app.hud.toast(`Time is running at ${t.speed}×. Use the speed buttons at the bottom to slow it down.`, 5000);
  }

  act(name) {
    const ui = this.ui;
    const app = ui.app;
    if (name === 'clearStations') {
      const had = app.extraStations.length;
      app.extraStations.length = 0;
      app.refreshIncidentMarkers();
      if (app.coverage) app.showCoverage(app.coverage.kind, app.coverage.basis);
      app.hud.toast(had ? 'Removed the stations you added.' : 'There were no added stations to remove.');
    } else if (name === 'placeStation') {
      app.setTool({ kind: 'station', station: 'fire' });
    } else if (name === 'addBest') {
      const r = ui.lab.bestNewStation('fire', 380);
      const t = r.top[0];
      if (!t) return false;
      if (app.extraStations.some((x) => Math.hypot(x.x - t.x, x.z - t.z) < 300)) {
        app.hud.toast('That station is already built. Remove it to start over.');
        return false;
      }
      app.addStation('fire', t.x, t.z);
      app.hud.toast(`Added a fire station ${t.where}.`, 5000);
    }
    return true;
  }

  /** The main button of an explore step: ask the question (and show it), with any action first. */
  async runStep(inv, s, i) {
    const ui = this.ui;
    const step = inv.steps[i];
    const q = this.fill(step.ask, inv, s, i);
    let before = null;
    if (step.act) {
      try { before = ui.asker.ask(q); } catch { before = null; }
      let did = false;
      try { did = this.act(step.act); } catch (err) { console.error('Guide action failed', err); }
      if (!did) before = null; // nothing changed, so there is no new before-and-after to show
    }
    const a = await ui.ask(q, { quiet: true, from: 'guide' });
    if (step.then?.layer) {
      try { ui.view.layer(step.then.layer); } catch (err) { console.error(err); }
    }
    s.ran[i] = true;
    if (before && a && !before.miss && !a.miss) s.ba[i] = { before: before.headline, after: a.headline };
    this.save();
    this.redraw();
  }

  /** Save the answer for this step to the notebook, with the student's note attached. */
  async saveEvidence(inv, s, i) {
    const ui = this.ui;
    const step = inv.steps[i];
    const q = this.fill(step.ask, inv, s, i);
    let a = ui.answer && ui.answer.question === q ? ui.answer : null;
    if (!a) {
      a = await ui.ask(q, { quiet: true, from: 'guide' });
      if (step.then?.layer) ui.view.layer(step.then.layer);
      s.ran[i] = true;
    }
    if (!a || a.miss) {
      ui.app.hud.toast('There is no answer to save yet. Press the yellow button first.');
      return;
    }
    if (!ui.notebook.has(q)) {
      ui.notebook.add({
        kind: 'answer', question: a.question, headline: a.headline, detail: a.sub,
        figures: (a.figures || []).filter((f) => !f.wide).slice(0, 8).map((f) => ({ label: f.label, value: f.value, badge: f.badge })),
        sources: a.sources, caveat: a.caveat, investigation: inv.title, note: (s.notes[i] || '').trim(),
      });
      ui.app.hud.toast('Saved to your notebook with a picture of the map and your note.');
    }
    this.save();
    this.redraw();
    if (ui.answer === a) ui.renderAnswer();
  }

  openNotebook(inv) {
    const nb = this.ui.notebook;
    // Start the write-up with the investigation's question if the student has not written one.
    try {
      const w = nb.state && nb.state.writeup;
      if (w && !String(w.question || '').trim()) {
        w.question = inv.title;
        if (typeof nb.saveSoon === 'function') nb.saveSoon();
      }
    } catch { /* the notebook still opens */ }
    nb.open();
  }

  /** Copy the prediction and the step notes into the notebook as cards. */
  shareNotes(inv, s) {
    const nb = this.ui.notebook;
    const mine = [s.choice, s.text.trim()].filter(Boolean);
    if (mine.length) {
      nb.add({ kind: 'prediction', question: inv.predict.prompt, headline: s.choice || 'My prediction', detail: s.text.trim(), figures: [], sources: [], image: null, investigation: inv.title });
    }
    const notes = inv.steps.map((st, i) => ({ t: st.title, n: (s.notes[i] || '').trim() })).filter((x) => x.n);
    if (notes.length || s.wonder.trim()) {
      nb.add({
        kind: 'observation', question: inv.title, headline: 'What I noticed',
        detail: [...notes.map((x) => `${x.t}: ${x.n}`), ...(s.wonder.trim() ? [`Still to find out: ${s.wonder.trim()}`] : [])].join(' '),
        figures: [], sources: [], image: null, investigation: inv.title,
      });
    }
    s.shared = true;
    this.save();
    this.ui.app.hud.toast('Added to your notebook.');
    this.redraw();
  }
}
