## Purpose

Defines the agent's spoken reply — how reply text reaches the user and is
spoken aloud — and interruption: what a push-to-talk press cancels, how
quickly, and what the document is left looking like.

## ADDED Requirements

### Requirement: The agent replies in words, not only in edits

The system SHALL produce a short reply in words for each instruction, and
SHALL speak it aloud in the browser that sent the instruction.

#### Scenario: An edit instruction is answered out loud

- **WHEN** a user gives an instruction that results in a document edit
- **THEN** the agent produces reply text, it is spoken aloud once, and the document edit still happens

#### Scenario: A question the agent cannot answer ends in words, not a failure

- **WHEN** an instruction asks for information the agent cannot verify
- **THEN** the turn completes with a spoken reply saying so, the document is unchanged, and the outcome is not reported as a failure

#### Scenario: Only the instructing browser speaks

- **WHEN** several browsers are connected to the same document and one of them sends an instruction
- **THEN** only that browser speaks the reply aloud, while the others may display it

#### Scenario: A missing voice never breaks the document path

- **WHEN** the browser has no speech synthesis available
- **THEN** instructions and document edits still work, and nothing fails visibly beyond the absence of a voice

### Requirement: The user can interrupt the agent at any time

The system SHALL treat the start of a push-to-talk press as a cancellation of
whatever the agent is currently saying and doing.

#### Scenario: Speech stops immediately

- **WHEN** the user presses push-to-talk while the agent is speaking
- **THEN** the audio stops within 200 ms, without waiting for any network request

#### Scenario: Typing stops almost immediately

- **WHEN** the user presses push-to-talk while the agent is inserting text
- **THEN** insertion stops within one chunk of text, and no further text from that instruction appears

#### Scenario: An interrupted edit leaves a valid document

- **WHEN** an insertion is cancelled partway
- **THEN** the text already inserted remains, the rest is dropped, the agent does not resume it on its own, and the document remains structurally valid for every participant

#### Scenario: The next instruction is handled fresh

- **WHEN** the user speaks a new instruction immediately after interrupting
- **THEN** it is handled against the document as it looks after the interruption, and the interrupted instruction is not resumed

#### Scenario: The agent remembers what it was interrupted doing

- **WHEN** the user refers back to the interrupted work in a later instruction
- **THEN** the agent has enough conversation history to continue it

#### Scenario: Cancelling is not an error

- **WHEN** a turn is cancelled by the user
- **THEN** the outcome is reported as stopped rather than as a failure

#### Scenario: Cancelling with nothing running is harmless

- **WHEN** a cancellation arrives while no instruction is being processed
- **THEN** the system reports that nothing was cancelled and continues normally

### Requirement: One instruction at a time, newest wins

The system SHALL process at most one instruction at a time, and a newly
arrived instruction SHALL cancel any instruction still in progress.

#### Scenario: A second instruction supersedes the first

- **WHEN** an instruction arrives while a previous one is still editing
- **THEN** the previous one is cancelled, only the new one continues, and the document shows no interleaving of the two
