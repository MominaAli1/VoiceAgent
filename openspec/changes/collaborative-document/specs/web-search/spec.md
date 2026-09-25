## Purpose

Defines how the agent looks things up: the spoken acknowledgement that
precedes a search, what a search returns, how a finding is written into the
document, and the rule that written facts carry their source.

## ADDED Requirements

### Requirement: The agent speaks before it searches

The system SHALL speak an acknowledgement before a search begins, so a search
never plays as silence.

#### Scenario: A factual question is acknowledged first

- **WHEN** the agent decides to search in response to an instruction
- **THEN** it speaks a short acknowledgement before the search request is sent

#### Scenario: The acknowledgement does not depend on the model writing one

- **WHEN** the agent decides to search but produces no words of its own
- **THEN** a fixed acknowledgement is spoken instead

### Requirement: Search returns a small, attributable set of results

The system SHALL return at most three results per search, each trimmed to a
short snippet and each carrying its title and source URL.

#### Scenario: Results are capped and trimmed

- **WHEN** a search succeeds
- **THEN** at most three results are returned, each with a title, a source URL, and a snippet no longer than the configured limit, cut at a word boundary

#### Scenario: Repeated searching within one instruction is bounded

- **WHEN** the agent has already searched the configured maximum times for one instruction
- **THEN** further search attempts are refused with a clear message and the instruction still completes

### Requirement: Findings are written into the document with their source

The system SHALL be able to add a new paragraph to the document, and any fact
written from a search SHALL carry a source URL that came from that search.

#### Scenario: A finding is spoken briefly and written fully

- **WHEN** a search answers the user's question
- **THEN** the agent speaks a one-sentence version and writes a fuller version into the document, including a source URL from the results

#### Scenario: Adding text does not require existing text to replace

- **WHEN** the instruction asks for something to be added rather than changed
- **THEN** the agent appends a new paragraph, which streams in the same way an edit does and can be interrupted the same way

### Requirement: A failed or unavailable search never invents an answer

The system SHALL treat an unavailable, failed, throttled or cancelled search
as "no answer", never as a reason to write an unverified fact.

#### Scenario: Search is not configured

- **WHEN** no search credential is configured
- **THEN** the agent says it cannot check the information, writes nothing into the document, and the instruction is not reported as a failure

#### Scenario: The search service fails or times out

- **WHEN** a search request fails, is throttled, or takes too long
- **THEN** the same "cannot check" outcome applies and the document is untouched

#### Scenario: A search interrupted by the user leaves nothing behind

- **WHEN** the user interrupts while a search is in flight
- **THEN** the search is abandoned, no paragraph is written, and the outcome is reported as stopped rather than failed
