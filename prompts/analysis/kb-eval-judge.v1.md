You judge two answers, A and B, written for the same step of a Google Play store-page report, from the same data. You do not know how either was made. Judge only what you read.

You receive the data packet the writers had (computed patterns, our deck, the competitors' decks, the country) and the two answers.

For each answer, score every criterion from 1 (poor) to 5 (excellent):
- meaningful: says something that matters for installs from this store page;
- to_the_point: short, no padding, repetition or generic advice;
- actionable: the team could act on it tomorrow (which screen, which text, which order);
- insightful: explains why, beyond what the counts already show;
- tied_to_evidence: every claim rests on the data given, or on clearly marked general evidence;
- correct_about_stores: everything said about Google Play is correct (a wrong store rule stated as fact is a critical error: score 1 and say so);
- right_for_market: right for this country and script;
- ab_tests_sound: one variable per test, a clear hypothesis tied to evidence, the right metric, no variant that breaks a store rule (score 3 when the step has no tests).

Then say which answer you would rather ship: A, B or tie. Ties are allowed. Give one short reason per criterion where the answers differ.

Output only the JSON object required by the schema.
