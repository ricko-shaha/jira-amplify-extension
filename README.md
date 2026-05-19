# Jira-Amplify Timelog Sync

Chrome extension that syncs Jira worklogs to Amplify timesheets. Includes priority scoring, activity/project/task mapping, time stats, and a reminder system.

## Prerequisites

- Google Chrome (or any Chromium-based browser)
- An active Jira Cloud account (must be logged in)
- An Amplify account at `amplify.echologyx.com`
- [Git](https://git-scm.com) installed (for pulling updates)

## Installation

1. Download or clone this repository to your machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `Jira-Amplify Extension` folder.
5. The extension icon will appear in your toolbar. Pin it for quick access.

## First-Time Setup

> **Important:** The extension must be installed in the same Chrome profile where you are logged in to Jira. It reads Jira cookies from your browser session to authenticate. Amplify does not have this requirement — it uses its own login with the credentials you enter in Settings.

1. **Log in to Jira** in the same Chrome profile where the extension is installed — it auto-detects your Jira domain from cookies. No manual Jira configuration needed.
2. Click the extension icon and go to the **Settings** tab.
3. Enter your **Amplify Email** and **Amplify Password**, then click **Save Settings**.
   - Credentials are stored locally in Chrome storage. They are only sent to Amplify for authentication.
4. Your Jira profile card should appear at the top of Settings once detection succeeds.

## Time Offset

The extension converts Jira worklog timestamps to Amplify's timezone (BD / GMT+6).

- **Auto (recommended)** — detects your Jira timezone and applies the correct offset automatically. No conversion if Jira is already in an Asian timezone; +8 hours if European.
- Override manually only if synced times look wrong. The Settings tab shows a table of offsets with example conversions.

## Tabs

### Sync
Select a date range using the calendar or presets (Today, Yesterday, Last 7 days, etc.) and click to analyze. The extension will:
- Fetch your Jira worklogs for that period
- Fetch existing Amplify entries
- Compare and show a breakdown:
  - **To create** - new entries that will be added to Amplify
  - **Already synced** - entries that already exist in Amplify (no action needed)
  - **Conflicts** - same ticket and date but different duration (you can choose to override)
  - **Unmapped** - entries that can't be synced because the project or task mapping is missing

Before syncing, you can review every entry in the table. If something looks wrong (wrong activity, wrong time, wrong project), you can edit it inline before clicking Sync. Nothing gets pushed to Amplify until you confirm.

### Priority
Shows your assigned Jira tickets ranked by a priority score. The score is calculated from four signals:

| Signal | Points | What it means |
|---|---|---|
| Swimlane position | 0 to 30 | Higher lane on the board = more important |
| Board column | 0 to 25 | Closer to the end of the workflow = finish it first |
| Deadline | 0 to 50 | Overdue or approaching deadline = more urgent |
| Jira priority | 0 to 15 | Based on Highest/High/Medium/Low/Lowest in Jira |

This works the same for all roles. The extension detects your role from Jira fields (Developer, QA, Designer, E-com Manager) and routes each ticket to the right board (Development Pipeline, Quality Assurance, Design Master). You don't need to configure anything.

Tickets in these statuses are excluded: `Done`, `Won't Do`, `Selected for Setup Validation`, `Setup Validation in Progress`, `Ready to Launch`.

### Activity Map
Controls how Jira worklogs get mapped to Amplify activities.

**Code mappings:** If your Jira worklog comment starts with a 6-digit code (e.g., `201000`), it maps to a specific Amplify activity. You can add, edit, or remove these mappings. For example:
- `201000` > Frontend Development
- `202010` > Frontend Dev - Bug Fix
- `203000` > Investigation

**Auto-matching:** If no code is found in the comment, the extension tries to match the description text against Amplify activity names automatically.

**Default activity:** If nothing matches, the default activity is used. You can change this from the dropdown.

Click **Save Activity Map** after making changes.

### Project Map
Maps Jira project prefixes to Amplify projects. The extension first tries to auto-detect this from your Amplify timesheet history. If it can't find a match, it falls back to this map.

For example, if your Jira tickets start with `VET-123`, you'd map the prefix `VET` to the corresponding Amplify project.

Click **+ Add project mapping** to add a new one. Click **Save Project Map** after making changes.

### Task Map
Overrides for specific Jira tickets. This has the highest priority and overrides both the Activity Map and Project Map.

Use this when a particular ticket needs a different project or activity than what the automatic mapping would pick. For example, if `DSI-456` should always go to "Meeting - Internal" instead of the default activity.

Click **+ Add task mapping** to add a new one. Click **Save Task Map** after making changes.

### Stats
View your worklog statistics for any date range. Shows total hours, daily averages, and breakdowns by project and activity. Use the calendar or presets to pick a range.

## Troubleshooting

- **"Could not detect Jira domain"** — Make sure you are logged in to Jira Cloud in Chrome before opening the extension.
- **Sync times look wrong** — Go to Settings and manually set the Time Offset instead of Auto.
- **Priority shows no tickets** — Your Jira must have role fields (Developer, QA, Designer, or E-com Manager) assigned to your account on active tickets.
- **Amplify login fails** — Double-check your Amplify email and password. The extension authenticates via the Amplify web login flow.

## Updating

To update the extension after new changes are pushed:
1. Run `git pull` in the extension folder.
2. Go to `chrome://extensions` and click the reload icon on the Jira-Amplify Timelog Sync card.
