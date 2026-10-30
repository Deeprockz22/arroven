# Investigation handover · CASE-2026-001
BLEED 1 FAULT recurring in cruise, not reproduced on ground
Aircraft: ZZ-DMO · MSN 0000 (fictional) · System: ATA 36 Pneumatic · engine 1 bleed · Evidence cutoff: 31 MAR 2026
Responsible engineer: Demo Engineer
UNAPPROVED DRAFT · generated 2026-10-30 06:47 UTC
Fictional demonstration case. No real operator, aircraft or records.

This record supports investigation reasoning. It does not state a root cause, direct maintenance or make an airworthiness decision. A citation shows where a statement came from, not that the statement is physically correct. Completing this review does not prove a repair or authorise aircraft release.

## Question
Why does BLEED 1 FAULT keep returning in cruise when every ground test and the shop test pass, and what has the work so far actually established?

## Sources
- S1 Technical log page TLB-4471 (Operator technical log · Demo Air (fictional)) · imported 2026-10-30 06:47 UTC · sha256 39ac43468458… · authorised (Fictional demonstration data. No customer records.)
- S2 Work order WO-0912 (Line maintenance system · contracted MRO (fictional)) · imported 2026-10-30 06:47 UTC · sha256 172873d0dc1b… · authorised (Fictional demonstration data. No customer records.)
- S3 Technical log page TLB-4472 (Operator technical log · Demo Air (fictional)) · imported 2026-10-30 06:47 UTC · sha256 757158654d82… · authorised (Fictional demonstration data. No customer records.)
- S4 Work order WO-0957 (Line maintenance system · contracted MRO (fictional)) · imported 2026-10-30 06:47 UTC · sha256 3963b2464880… · authorised (Fictional demonstration data. No customer records.)
- S5 Shop report SR-88120 (Component repair shop (fictional)) · imported 2026-10-30 06:47 UTC · sha256 f2fea1717275… · authorised (Fictional demonstration data. No customer records.)
- S6 Technical log page TLB-4475 (Operator technical log · Demo Air (fictional)) · imported 2026-10-30 06:47 UTC · sha256 2ba246b6fad2… · authorised (Fictional demonstration data. No customer records.)
- S7 Maintenance message log, 29 MAR (Operator maintenance information system (fictional)) · imported 2026-10-30 06:47 UTC · sha256 526df815a72f… · authorised (Fictional demonstration data. No customer records.)
- S8 Engineering note EN-0331 (Technical services engineering (fictional)) · imported 2026-10-30 06:47 UTC · sha256 415b7d83c979… · authorised (Fictional demonstration data. No customer records.)
- U1 BMC 1 fault history download, 29 MAR event · UNAVAILABLE: Requested from line station 30 MAR 2026. Not received by cutoff.. Missing access does not prove missing evidence.
- U2 ZZ-DMP harness chafe record (2025) · UNAVAILABLE: Referenced in EN-0331. Not attached and not imported.. Missing access does not prove missing evidence.

## Checked chronology
- 02 MAR 2026 [S1:2] C1 Reported: Crew reported BLEED 1 FAULT in cruise at FL370, about 40 min after top of climb. Bleed 1 lost; QRH reset unsuccessful. (Conditions: Cruise FL370, SAT -56 C)
- 03 MAR 2026 [S1:3] C2 Test result: BMC 1 BITE recorded fault message PRV 1 POSITION DISAGREE.
- 03 MAR 2026 [S2:2] C4 Planned, not performed: PRV 1 replacement planned and deferred; no serviceable spare at station. Not performed under WO-0912. [wording corrected by engineer]
- 03 MAR 2026 [S2:4] C3 Test result: PRV 1 ground operational test satisfactory. (Conditions: Ground, ambient +16 C, engine 1 idle)
- 11 MAR 2026 [S3:2] C6 Reported: BLEED 1 FAULT recurred in cruise at FL360, about 55 min after TOC. Bleed 1 lost for remainder of flight. (Conditions: Cruise FL360)
- 12 MAR 2026 [S4:2] C7 Work performed: PRV 1 S/N V1187 removed; S/N V2240 installed.
- 20 MAR 2026 [S5:4] C10 Shop finding: Removed unit S/N V1187 passed room-temperature and -40 C cold-soak functional tests; no fault found. (Conditions: Shop bench, -40 C cold soak 2 h)
- 29 MAR 2026 [S6:2] C11 Reported: BLEED 1 FAULT at FL380, about 1 h after TOC; bleed 1 recovered after about 4 min without crew action. (Conditions: Cruise FL380)
    Uncertain reading: The message log for this date shows two fault events (10:42 and 11:15 UTC). The tech log entry describes one.

## Explanations, evidence and assessment

### H1 PRV 1 valve sticks at cruise temperature
PRV 1 intermittently fails to reach its commanded position when cold-soaked in cruise, and works normally once warm on the ground.
Assessment: Left unresolved. Weakened by recurrence with a second unit, but no test has reproduced cruise temperature. Left unresolved pending a cold test and the BMC history.
Supports 0 · Challenges 1 · Inconclusive 1
- CHALLENGES · C11 [S6:2] BLEED 1 FAULT at FL380, about 1 h after TOC; bleed 1 recovered after about 4 min without crew action.
    Why: Fault recurred with a different unit installed. A valve-only explanation would need two faulty units.
- INCONCLUSIVE · C10 [S5:4] Removed unit S/N V1187 passed room-temperature and -40 C cold-soak functional tests; no fault found.
    Why: Shop cold soak was -40 C against SAT -56 C in cruise. NFF does not exclude an intermittent valve fault.

### H2 Pylon harness or connector fault
An intermittent open or short in the engine 1 pylon harness or the PRV 1 connector, sensitive to vibration or thermal contraction in cruise, corrupts the position signal.
Assessment: Not yet assessed
Supports 0 · Challenges 0 · Inconclusive 0
- No engineer decisions recorded for this explanation.

### H3 BMC 1 or sensor input error
BMC 1, or a bleed sensor input it relies on, generates a false position-disagree indication while the valve itself operates correctly.
Assessment: Not yet assessed
Supports 0 · Challenges 0 · Inconclusive 0
- No engineer decisions recorded for this explanation.

## Comparisons of findings (AI-prepared, reviewed for relevance)
- X1 Records differ · Ground and shop tests against in-flight reports [C1, C3, C6, C10, C11]
    Every fault was reported in cruise above FL360 at about -56 C. Ground tests ran at +16 C and the shop cold soak at -40 C. No test reproduced the reported conditions, so passing tests do not show the fault is absent.
- X2 Records differ · Tech log against message log for 29 MAR [C11, C12]
    The tech log describes one event; the message log records a second at 11:15 UTC. The count of events on this flight is unclear.

2 AI proposal(s) have not been reviewed and are not part of this record.

## Conflicts and gaps
- CONFLICT F1 [S6:2, S7:2, S7:4] Tech log TLB-4475 entry 4 describes one fault event on 29 MAR; the maintenance message log shows two (10:42 and 11:15 UTC).
- GAP F2 [S2:3, S4:4] The pylon harness connector inspection was planned twice and never performed. No record tests the wiring path.
- GAP F3 [S2:4, S4:3, S1:2] All ground tests ran at +16 to +18 C. All in-flight faults occurred in cruise above FL360, roughly 40 to 60 min after top of climb. No test reproduced those conditions.
- GAP F4 [U1] BMC 1 fault history for 29 MAR is unavailable, so it is unknown whether PRV 1 POSITION DISAGREE recurred with S/N V2240 installed.
- GAP F5 [S8:2, U2] The sister-aircraft chafe finding cited in EN-0331 has no attached record.

## Open questions
- Q1 Was there one fault event or two on 29 MAR? Confirm with the crew report and BMC history.
- Q2 Can the harness connector inspection with wiggle test be brought forward ahead of the A-check?

## Not included
- 5 AI-drafted statement(s) not yet checked; 0 statement(s) rejected by an engineer.
