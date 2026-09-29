# Gym log on Google Sheets

This version needs no server or database. Google runs it as an Apps Script web app, and every set you log becomes a row in your **Gym log** Google Sheet (Session, Date, Day, Exercise, Set, Weight kg, Reps, Warm-up, Note). You can open the sheet to check or fix anything, and the app reads your edits on its next load.

`Code.gs` reads and writes the sheet. `Index.html` is the same phone front end as the Flask version: suggested weights, rest timer, progress and history.

## Set it up (about 5 minutes, easiest on a computer)

1. Go to [script.google.com](https://script.google.com) and click **New project**. Name it "Gym log".
2. Replace everything in `Code.gs` with the contents of [`Code.gs`](Code.gs). `SHEET_ID` already points at the Gym log sheet in your Drive.
3. Click **+** next to Files, choose **HTML**, name it `Index` (no extension) and paste in [`Index.html`](Index.html).
4. Click **Deploy → New deployment**, choose the type **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Only myself
5. Click **Deploy** and allow access to your spreadsheets when Google asks. You may see "Google hasn't verified this app": it's your own script, so choose **Advanced → Go to Gym log**.
6. Copy the **Web app URL** (it ends in `/exec`). Open it on your phone, signed in to the same Google account, and use **Add to Home Screen**.

Only your Google account can open the URL. Google shows a thin "created by a Google Apps Script user" bar at the top of the page; that's normal.

## Updating the code

After changing either file, use **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

## Using a different sheet

Set `SHEET_ID` to the long id from the sheet's URL, or set it to `''` and create the script from inside a sheet (**Extensions → Apps Script**) to use that sheet. The app reads the first tab and adds the header row if the tab is empty.
