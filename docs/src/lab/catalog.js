// What the page knows how to talk about: every map measure in plain words (with the
// phrases students use for it), the kinds of evidence behind a number, and a small glossary.

/** Where a number comes from. Every figure in an answer carries one of these. */
export const BADGES = {
  counted: { label: 'Counted', tip: 'An actual count, like the 2020 Census.' },
  surveyed: { label: 'Surveyed', tip: 'An estimate from a sample survey; it has a margin of error.' },
  simulated: { label: 'Simulated', tip: 'Calculated by this simulation, a model of the real city.' },
  measured: { label: 'Measured', tip: 'Measured directly, like elevation or a traffic counter.' },
};

export const GROUPS = ['People', 'Homes', 'Money', 'School and work', 'Getting around'];

const ACS = 'American Community Survey 2020–2024 (U.S. Census Bureau), by block group';
const DEC = '2020 Census, by block';
const LODES = 'Census LEHD jobs data, 2023, by block';

/**
 * id        key in areas.json
 * label     name on the map and in lists
 * noun      how it reads inside a sentence: "the share of residents under 18"
 * hi / lo   superlative phrases: "the most kids", "the fewest kids"
 * def       plain-language definition
 * syn       phrases that mean this measure (regular expressions, tested against the lowercased question)
 * hiWords / loWords   extra words that pick a direction for this measure ("oldest homes" means the lowest year)
 */
export const METRICS = [
  // --- People -----------------------------------------------------------------------------
  { id: 'population', group: 'People', label: 'Population', noun: 'the number of people', hi: 'the most people', lo: 'the fewest people', badge: 'surveyed', source: ACS,
    def: 'How many people live in each area.',
    generic: true, unitWord: 'people',
    syn: [/\bpopulation\b/, /\bhow many people\b/, /\bpeople live\b/, /\bresidents\b/, /\bmost people\b/, /\bfewest people\b/] },
  { id: 'density', group: 'People', label: 'People per square mile', noun: 'the number of people per square mile', hi: 'the most people per square mile', lo: 'the fewest people per square mile', unitWord: 'people per square mile', badge: 'surveyed', source: ACS,
    def: 'Population divided by land area. A high number means people live close together; a low number means homes are spread out.',
    syn: [/\bdens(e|ity|est)\b/, /\bcrowded\b/, /\bpacked\b/, /\bspread out\b/, /\bper square mile\b/, /\bclose together\b/, /\brural\b/, /\burban\b/],
    hiWords: [/\bmost crowded\b/, /\bdensest\b/, /\bmost urban\b/], loWords: [/\bspread out\b/, /\bemptiest\b/, /\bmost rural\b/, /\bleast crowded\b/] },
  { id: 'median_age', group: 'People', label: 'Median age', noun: 'the median age', hi: 'the oldest residents', lo: 'the youngest residents', badge: 'surveyed', source: ACS,
    def: 'The age in the middle: half the people who live there are older and half are younger.',
    syn: [/\bmedian age\b/, /\baverage age\b/, /\bhow old (are|is) (the )?(people|residents|everyone|folks)\b/, /\bage of (the )?(people|residents)\b/, /\byoungest (people|residents|neighbou?rhoods?|areas?|places?)\b/, /\boldest (people|residents|neighbou?rhoods?|areas?|places?)\b/, /\bages?\b/],
    hiWords: [/\boldest\b/], loWords: [/\byoungest\b/] },
  { id: 'pct_under_18', group: 'People', label: 'Kids and teens (under 18)', noun: 'the share of residents under 18', hi: 'the most kids and teens', lo: 'the fewest kids and teens', badge: 'surveyed', source: ACS,
    def: 'The share of residents who are younger than 18.',
    syn: [/\bkids?\b/, /\bchildren\b/, /\bchild\b/, /\bteens?\b/, /\bteenagers?\b/, /\bunder 18\b/, /\byoung people\b/, /\byouth\b/, /\bstudents live\b/, /\bminors\b/] },
  { id: 'pct_65_plus', group: 'People', label: 'Older adults (65 and up)', noun: 'the share of residents 65 and older', hi: 'the most older adults', lo: 'the fewest older adults', badge: 'surveyed', source: ACS,
    def: 'The share of residents who are 65 or older.',
    syn: [/\bseniors?\b/, /\bolder (adults|people|residents)\b/, /\bold people\b/, /\belderly\b/, /\bretire(d|es|ment)\b/, /\b65\b/, /\bgrandparents?\b/] },
  { id: 'avg_household_size', group: 'People', label: 'People per household', noun: 'the average number of people per household', hi: 'the biggest households', lo: 'the smallest households', unitWord: 'people per household', badge: 'surveyed', source: ACS,
    def: 'The average number of people who live together in one home.',
    syn: [/\bhousehold size\b/, /\bpeople per (household|home|house)\b/, /\b(big|large|small)(ger|gest|est)? (households?|families)\b/, /\bfamily size\b/, /\blive alone\b/] },
  { id: 'pct_hh_kids', group: 'People', label: 'Households with kids', noun: 'the share of households with children under 18', hi: 'the most households with kids', lo: 'the fewest households with kids', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 households, how many include someone under 18.',
    syn: [/\bhouseholds? with (kids|children)\b/, /\bfamilies with (kids|children)\b/, /\bhomes with (kids|children)\b/] },
  { id: 'pct_hispanic', group: 'People', label: 'Hispanic or Latino residents', noun: 'the share of residents who are Hispanic or Latino', hi: 'the largest share of Hispanic or Latino residents', lo: 'the smallest share of Hispanic or Latino residents', badge: 'surveyed', source: ACS,
    def: 'The share of residents who identify as Hispanic or Latino (of any race).',
    syn: [/\bhispanic\b/, /\blatin[oaex]s?\b/] },
  { id: 'pct_black', group: 'People', label: 'Black residents', noun: 'the share of residents who are Black', hi: 'the largest share of Black residents', lo: 'the smallest share of Black residents', badge: 'surveyed', source: ACS,
    def: 'The share of residents who identify as Black or African American (and not Hispanic).',
    syn: [/\bblack (residents|people|families|community|population|neighbou?rhoods?)\b/, /\bafrican.american\b/] },
  { id: 'pct_kids_b', group: 'People', label: 'School-age kids, 5–17 (2020 count)', noun: 'the share of residents ages 5 to 17', hi: 'the most school-age kids', lo: 'the fewest school-age kids', badge: 'counted', source: DEC, minPop: 60,
    def: 'The share of residents ages 5 to 17 in the 2020 Census, block by block (the smallest areas the Census reports).',
    syn: [/\bschool.?age\b/, /\bages? 5\b/] },
  { id: 'density_b', group: 'People', label: 'People per square mile (2020 count)', noun: 'the number of people per square mile', hi: 'the most people per square mile', lo: 'the fewest people per square mile', unitWord: 'people per square mile', badge: 'counted', source: DEC, minPop: 60,
    def: 'The 2020 Census count divided by land area, block by block.', syn: [] },

  // --- Homes ---------------------------------------------------------------------------------
  { id: 'median_home_value', group: 'Homes', label: 'Home value', noun: 'the median home value', hi: 'the most expensive homes', lo: 'the least expensive homes', badge: 'surveyed', source: ACS,
    def: 'The value in the middle of all owner-occupied homes: half are worth more and half are worth less. Owners estimate the value themselves on the survey.',
    syn: [/\bhome (values?|prices?)\b/, /\bhouse (values?|prices?)\b/, /\bhousing (costs?|prices?)\b/, /\b(cost|price) of (a |the )?(home|house)s?\b/, /\b(expensive|cheap|affordable|priciest|cheapest)\b.*\b(homes?|houses?|housing|live)\b/, /\b(homes?|houses?|housing)\b.*\b(expensive|cheap|affordable|priciest|cheapest|cost)\b/, /\bhow much (do|does) (a )?(homes?|houses?) cost\b/, /\bworth\b/],
    hiWords: [/\b(most expensive|priciest|costliest|fanciest)\b/], loWords: [/\b(cheapest|least expensive|most affordable)\b/] },
  { id: 'median_rent', group: 'Homes', label: 'Rent', noun: 'the median monthly rent', hi: 'the highest rent', lo: 'the lowest rent', badge: 'surveyed', source: ACS,
    def: 'The monthly rent in the middle (including utilities): half of renters pay more and half pay less.',
    syn: [/\brents?\b(?! (out|ed))/, /\bcost to rent\b/],
    hiWords: [/\b(most expensive|priciest)\b/], loWords: [/\b(cheapest|least expensive|most affordable)\b/] },
  { id: 'pct_renter', group: 'Homes', label: 'Renters', noun: 'the share of homes that are rented', hi: 'the most renters', lo: 'the fewest renters', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 homes people live in, how many are rented instead of owned.',
    syn: [/\brenters?\b/, /\brenting\b/, /\brented\b/, /\brent (their|a) (home|house|apartment)\b/, /\bown (their|a) (home|house)\b/, /\bhomeowners?\b/, /\bowners?\b/] },
  { id: 'median_year_built', group: 'Homes', label: 'When homes were built', noun: 'the median year homes were built', hi: 'the newest homes', lo: 'the oldest homes', badge: 'surveyed', source: ACS,
    def: 'The year in the middle: half the homes there were built before it and half after.',
    syn: [/\byear built\b/, /\bhow old (are|is) (the )?(homes?|houses?|buildings?)\b/, /\bage of (the )?(homes?|houses?|buildings?)\b/, /\b(old|new)(er|est)? (homes?|houses?|buildings?|neighbou?rhoods?|part)\b/, /\bwhen were .*\bbuilt\b/, /\bhistoric\b/, /\b(homes?|houses?) (were )?built\b/],
    hiWords: [/\bnewest\b/], loWords: [/\boldest\b/, /\bhistoric\b/] },
  { id: 'pct_single_family', group: 'Homes', label: 'Single-family houses', noun: 'the share of homes that are single-family houses', hi: 'the most single-family houses', lo: 'the fewest single-family houses', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 homes, how many are stand-alone houses built for one household.',
    syn: [/\bsingle.family\b/, /\bdetached\b/, /\bhouses with yards\b/] },
  { id: 'pct_apartments', group: 'Homes', label: 'Apartments (5+ units)', noun: 'the share of homes in apartment buildings', hi: 'the most apartments', lo: 'the fewest apartments', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 homes, how many are in buildings with five or more homes.',
    syn: [/\bapartments?\b/, /\bcondos?\b/, /\bmulti.?family\b/] },
  { id: 'pct_mobile', group: 'Homes', label: 'Manufactured homes', noun: 'the share of homes that are manufactured (mobile) homes', hi: 'the most manufactured homes', lo: 'the fewest manufactured homes', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 homes, how many are manufactured homes (also called mobile homes).',
    syn: [/\bmobile homes?\b/, /\bmanufactured homes?\b/, /\btrailers?\b/] },
  { id: 'pct_seasonal', group: 'Homes', label: 'Vacation and second homes', noun: 'the share of homes kept for vacations or occasional use', hi: 'the most vacation homes', lo: 'the fewest vacation homes', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 homes, how many are kept for seasonal, vacation or occasional use instead of being lived in year-round.',
    syn: [/\bvacation (homes?|houses?|rentals?)\b/, /\bsecond homes?\b/, /\bseasonal\b/, /\bairbnbs?\b/, /\bshort.term rentals?\b/, /\bsummer homes?\b/] },
  { id: 'pct_vacant_b', group: 'Homes', label: 'Empty homes (2020 count)', noun: 'the share of homes that were vacant', hi: 'the most empty homes', lo: 'the fewest empty homes', badge: 'counted', source: DEC, minPop: 0, minUnits: 30,
    def: 'Out of every 100 homes, how many had nobody living in them on Census day in 2020.',
    syn: [/\bvacant\b/, /\bempty (homes?|houses?)\b/, /\babandoned\b/] },

  // --- Money ---------------------------------------------------------------------------------
  { id: 'median_income', group: 'Money', label: 'Household income', noun: 'the median household income', hi: 'the highest incomes', lo: 'the lowest incomes', badge: 'surveyed', source: ACS,
    def: 'The yearly income in the middle of all households: half earn more and half earn less. It counts everyone in the home together.',
    syn: [/\bincomes?\b/, /\bearn(s|ings)?\b/, /\bsalar(y|ies)\b/, /\bmake the most money\b/, /\bhow much money\b/, /\b(rich|wealthy|poor)(er|est)?\b/, /\bwealth\b/, /\bmoney\b/],
    hiWords: [/\b(richest|wealthiest)\b/], loWords: [/\bpoorest\b/] },
  { id: 'per_capita_income', group: 'Money', label: 'Income per person', noun: 'the income per person', hi: 'the highest income per person', lo: 'the lowest income per person', badge: 'surveyed', source: ACS,
    def: 'All the income earned in an area divided by everyone who lives there, including kids.',
    syn: [/\bper capita\b/, /\bincome per person\b/] },
  { id: 'pct_poverty', group: 'Money', label: 'Below the poverty line', noun: 'the share of residents living below the poverty line', hi: 'the highest poverty rate', lo: 'the lowest poverty rate', badge: 'surveyed', source: ACS,
    def: 'The share of residents whose household income is below the federal poverty line, an amount the government sets by family size.',
    syn: [/\bpoverty\b/, /\bpoor people\b/, /\blow.income\b/, /\bstruggl/] },
  { id: 'pct_hh_under_35k', group: 'Money', label: 'Households earning under $35,000', noun: 'the share of households earning under $35,000 a year', hi: 'the most households under $35,000', lo: 'the fewest households under $35,000', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 households, how many earn less than $35,000 a year.',
    syn: [/\bunder \$?35/, /\bless than \$?35/] },
  { id: 'pct_hh_100k', group: 'Money', label: 'Households earning $100,000 or more', noun: 'the share of households earning $100,000 or more a year', hi: 'the most households over $100,000', lo: 'the fewest households over $100,000', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 households, how many earn $100,000 or more a year.',
    syn: [/\b(over|above|more than) \$?100/, /\b\$?100k\b/, /\bsix figures\b/] },

  // --- School and work ----------------------------------------------------------------------
  { id: 'pct_bachelors', group: 'School and work', label: 'College degrees', noun: "the share of adults with a bachelor's degree or more", hi: 'the most college graduates', lo: 'the fewest college graduates', badge: 'surveyed', source: ACS,
    def: "Out of every 100 adults age 25 and up, how many finished a four-year college degree (a bachelor's) or more.",
    syn: [/\bcollege\b/, /\bdegrees?\b/, /\bbachelor/, /\bgraduat(e|es|ed) (from )?college\b/, /\beducat(ed|ion)\b/, /\buniversity degree\b/] },
  { id: 'pct_graduate', group: 'School and work', label: 'Graduate degrees', noun: 'the share of adults with a graduate or professional degree', hi: 'the most graduate degrees', lo: 'the fewest graduate degrees', badge: 'surveyed', source: ACS,
    def: "Out of every 100 adults age 25 and up, how many have a degree beyond a bachelor's, like a master's, a law or medical degree, or a doctorate.",
    syn: [/\bgraduate degrees?\b/, /\bmaster'?s\b/, /\bdoctorates?\b/, /\bphds?\b/, /\bprofessional degrees?\b/] },
  { id: 'jobs_density_b', group: 'School and work', label: 'Where the jobs are', noun: 'the number of jobs', hi: 'the most jobs', lo: 'the fewest jobs', unitWord: 'jobs', badge: 'counted', source: LODES, minPop: 0,
    def: 'Jobs located in each block, per square mile of land. It shows where people work, not where workers live.',
    syn: [/\bjobs?\b/, /\bworkplaces?\b/, /\bwhere (do )?people work\b/, /\b(people|many|workers) work\b/, /\bwork(s|ers|ing)? (in|at|near|around|downtown)\b/, /\bemploy(ers?|ment)\b/, /\bbusinesses\b/, /\boffices\b/] },
  { id: 'pct_wfh', group: 'School and work', label: 'Work from home', noun: 'the share of workers who work from home', hi: 'the most people working from home', lo: 'the fewest people working from home', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 workers, how many usually work from home instead of traveling to a job.',
    syn: [/\bwork(s|ing)? (from|at) home\b/, /\bremote(ly)?\b/, /\bwfh\b/, /\btelecommut/] },

  // --- Getting around -----------------------------------------------------------------------
  { id: 'pct_commute_30', group: 'Getting around', label: 'Long commutes (30+ minutes)', noun: 'the share of workers whose trip to work takes 30 minutes or more', hi: 'the most long commutes', lo: 'the fewest long commutes', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 workers who travel to a job, how many spend 30 minutes or more getting there.',
    syn: [/\bcommut(e|es|ing|ers)\b/, /\b(trip|drive|ride|travel|get) to work\b/, /\b30.?minutes?\b.*\bwork\b/] },
  { id: 'pct_drive_alone', group: 'Getting around', label: 'Drive alone to work', noun: 'the share of workers who drive to work alone', hi: 'the most solo drivers', lo: 'the fewest solo drivers', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 workers, how many drive to work by themselves (no carpool, bus, bike or walking).',
    syn: [/\bdriv(e|es|ing) alone\b/, /\bsolo driv/, /\bcarpool/, /\bby themselves\b/] },
  { id: 'pct_leave_before_7', group: 'Getting around', label: 'Leave for work before 7 a.m.', noun: 'the share of workers who leave home before 7 a.m.', hi: 'the most early risers', lo: 'the fewest early risers', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 workers who travel to a job, how many leave home before 7:00 in the morning.',
    syn: [/\bbefore (7|seven)\b/, /\bleave (home |for work )?(the )?earl(y|iest)\b/, /\bearly risers?\b/, /\bwake up earl/] },
  { id: 'pct_no_vehicle', group: 'Getting around', label: 'Households without a car', noun: 'the share of households with no car or truck', hi: 'the most households without a car', lo: 'the fewest households without a car', badge: 'surveyed', source: ACS,
    def: 'Out of every 100 households, how many have no car, truck or van at home.',
    syn: [/\b(no|without an?y?|don'?t have an?y?|do not have an?y?) (cars?|vehicles?|trucks?)\b/, /\bcar.?(less|free)\b/, /\bvehicles?\b/, /\bown a car\b/, /\bhave (a )?cars?\b/] },
];

export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));

/** The block-group measure a block-level layer stands in for (used when comparing towns). */
export const BLOCK_TWIN = { pct_kids_b: 'pct_under_18', density_b: 'density' };

export const GLOSSARY = [
  { term: 'Median', def: 'The value in the middle when you line everything up from smallest to largest. Half are above it and half are below. Unlike an average, a few huge values do not pull it up.' },
  { term: 'Average (mean)', def: 'Add everything up and divide by how many there are. A few very large values can pull an average up.' },
  { term: 'Block group', def: 'A small area the Census Bureau uses to report survey results: a handful of blocks, usually home to 600 to 3,000 people. Buncombe County has 168 of them.' },
  { term: 'Census block', def: 'The smallest area the Census reports, often a single city block. Buncombe County has 4,841. Only the once-a-decade count is reported this finely.' },
  { term: 'Census', def: 'The count of every person in the country, taken every ten years. The latest was in 2020.' },
  { term: 'American Community Survey', def: 'A yearly Census Bureau survey sent to a sample of homes. Five years of answers are combined so small areas have enough responses. Because it is a sample, every number is an estimate.' },
  { term: 'Margin of error', def: 'How far off a survey estimate might be. An income of $70,000 with a margin of error of $4,000 most likely means the real value is between $66,000 and $74,000. Small areas have bigger margins.' },
  { term: 'Estimate', def: 'A careful best guess based on data, not an exact count.' },
  { term: 'Household', def: 'Everyone who lives together in one home, whether or not they are related.' },
  { term: 'Per capita', def: 'Per person. Divide the total by the number of people.' },
  { term: 'Density', def: 'How much of something there is in a given space, like people per square mile.' },
  { term: 'Free flow', def: 'How long a drive takes with no traffic at all, moving at the usual speed for each road.' },
  { term: 'Congestion', def: 'Traffic slow enough that a trip takes longer than it would on empty roads.' },
  { term: 'Simulation', def: 'A computer model that follows rules to imitate something real. This one sends about 780,000 imaginary car and truck trips over the real road map on a school day to imitate Buncombe County traffic.' },
  { term: 'Model', def: 'A simplified version of something real, built to answer questions. A model is useful, but it is never exactly right.' },
  { term: 'Correlation', def: 'When two things tend to go up and down together. Correlation alone does not prove that one causes the other.' },
  { term: 'Response time', def: 'The time from a 911 call until help arrives: answering the call, getting the crew moving, and the drive.' },
  { term: 'Commute', def: 'The regular trip between home and work or school.' },
  { term: 'Poverty line', def: 'An income level set each year by the federal government. A household earning less than it is counted as living in poverty. It depends on the number of people in the household.' },
  { term: 'Evidence', def: 'Facts or data that support a claim.' },
  { term: 'Claim', def: 'A statement that answers a question and can be backed up with evidence.' },
];
