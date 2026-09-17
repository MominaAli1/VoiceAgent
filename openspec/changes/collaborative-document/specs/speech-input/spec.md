## Purpose

Defines how a spoken instruction reaches the agent: push-to-talk microphone
capture, the audio format sent for transcription, the streaming transcription
session and its lifecycle, partial transcripts shown as ghost text, and
delivery of the final transcript to the existing instruction entry point.

## ADDED Requirements

### Requirement: Push-to-talk capture

The system SHALL capture speech only while the user holds a push-to-talk key
or an on-screen hold control, and SHALL treat everything said during one hold
as one instruction.

#### Scenario: Holding the key captures speech

- **WHEN** the user holds the push-to-talk key and speaks
- **THEN** audio is sent for transcription for the duration of the hold, and no audio is sent before the hold or after release

#### Scenario: The push-to-talk key never edits text

- **WHEN** the push-to-talk key is held while the editor or instruction input has focus
- **THEN** no character is typed into either

#### Scenario: Losing focus ends the press

- **WHEN** the browser window loses focus while the key is held
- **THEN** the press ends as if the key had been released

#### Scenario: A pause inside one press is still one instruction

- **WHEN** the user pauses mid-sentence while still holding the key, then continues speaking and releases
- **THEN** exactly one instruction is produced, containing everything said during the hold

### Requirement: Transcription audio format

The system SHALL send audio for transcription as 16 kHz mono 16-bit
little-endian PCM, in fixed 50 ms frames, regardless of the microphone's
native sample rate, with echo cancellation enabled at capture.

#### Scenario: Frames match the declared format

- **WHEN** audio is being sent during a press
- **THEN** every frame is 800 samples of 16 kHz mono PCM16, and the transcription session declares a 16 kHz sample rate

#### Scenario: The start of speech is not clipped

- **WHEN** the user begins speaking immediately on pressing the key, before the transcription session is ready
- **THEN** the audio captured before the session was ready is still transcribed, in order

### Requirement: Credential isolation

The system SHALL keep the transcription service's permanent API credential on
the server only, and SHALL give the browser a short-lived token instead.

#### Scenario: The browser never receives the permanent credential

- **WHEN** the browser starts a transcription session
- **THEN** it authenticates with a temporary token obtained from the agent process, and the permanent credential appears in no browser file, URL, response body, or log line

#### Scenario: A missing credential is visible but does not stop typed instructions

- **WHEN** the agent process runs without the transcription credential configured
- **THEN** typed instructions still work, the process logs a warning naming the missing configuration, and a push-to-talk press shows a message saying speech is unavailable

### Requirement: Session lifecycle bounds billable time

The system SHALL reuse one transcription session across presses that happen
close together, and SHALL close the session after a period with no press and
when the page is closed.

#### Scenario: Rapid presses share a session

- **WHEN** the user makes several presses within a minute
- **THEN** they are served by a single transcription session rather than one new session per press

#### Scenario: An idle session is closed

- **WHEN** no press occurs for the configured idle period
- **THEN** the session is explicitly terminated, and the next press opens a new one and works normally

#### Scenario: Closing the page closes the session

- **WHEN** the page is closed or navigated away from
- **THEN** the session is terminated, and if the page cannot say so, the transcription service closes it after its own inactivity timeout

### Requirement: Ghost text and final transcript

The system SHALL display partial transcripts while the user speaks, SHALL
display the final transcript on release, and SHALL NOT write either into the
shared document.

#### Scenario: Partials appear as ghost text

- **WHEN** the user is speaking during a press
- **THEN** partial transcripts appear in a transcript area outside the document, visually distinct from final text

#### Scenario: Partials never reach the shared document

- **WHEN** partial transcripts are displayed
- **THEN** no participant's copy of the shared document changes as a result

#### Scenario: Nothing heard, nothing sent

- **WHEN** a press ends with an empty transcript
- **THEN** no instruction is submitted and the user is told nothing was caught

### Requirement: Spoken instructions use the typed-instruction path

The system SHALL submit a non-empty final transcript through the same
instruction entry point and contract as a typed instruction, so that its
outcome is reported the same way.

#### Scenario: A spoken instruction edits the document

- **WHEN** the user holds the key, speaks an instruction that identifies existing text, and releases
- **THEN** the final transcript is submitted as an instruction, the resulting edit appears in every connected tab, and the outcome is reported in the same status area as a typed instruction

#### Scenario: A misheard instruction fails visibly

- **WHEN** the final transcript refers to text that does not exist in the document
- **THEN** the outcome shown is a failure, and the document is not changed
