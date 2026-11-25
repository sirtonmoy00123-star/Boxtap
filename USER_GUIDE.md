# BoxTap user guide (what is built today)

BoxTap keeps everything on your phone, in the browser. Nothing goes to a server unless you connect your own Google Drive.

## First screen

- **New to BoxTap**: start fresh on this phone.
- **Restore from Google Drive**: bring back your boxes from your Drive backup (for a new or reset phone). You sign in with Google, then type your 12-word code.
- **Restore from a backup file**: bring back your boxes from a `.btbak` file you saved earlier.
- **English / বাংলা**: the language for the app.

## Setting up (New to BoxTap)

- **What will you use BoxTap for?**
  - *Moving or storage*: boxes, rooms and what's inside (Home mode).
  - *Selling stock*: stock kept in boxes (Seller mode). The stock buttons come in a later phase.
- **Name this list**: any name, for example "Our move". You can leave it empty.
- **Warning box**: your boxes live only in this browser. Clearing the site's data, or deleting the home-screen icon on iPhone, deletes them. Back up.
- **Start**: shows your **12-word recovery code**.
  - Write the words down in order, or tap **Print**.
  - **I've written it down**: BoxTap asks for 3 of the words to check, then **Confirm**.
  - Keep the code safe. Nobody, not even BoxTap, can get it back for you. You need it to restore on a new phone.

## Home screen (your boxes)

- **Search items or boxes**: type part of an item name, a box name, where the box is, or "Box 12". Works with Bangla too.
- **Box list**: each box shows its number, name, how many items it holds, and "Fragile" if set. Tap a box to open it.
- **Bin**: boxes and items you deleted, kept for 30 days.
- **Settings**: backups, Google Drive, printing labels.
- **Scan**: point the camera at a BoxTap label to open that box.
- **Add box**: makes the next numbered box with its own label code, and opens it. Before your 5th box, BoxTap asks you to install it first (see Install below). **Not now** carries on.
- **Move count** (Home mode): "3 of 10 boxes arrived · 1 unpacked", once you start marking boxes.
- **Last backup** (bottom): the date of your last backup file or Google Drive copy. Without Drive, a reminder appears after 7 days with a **Back up now** button.

Free plan: up to 12 boxes in Home mode, or 50 items in Seller mode. When you reach the limit, an upgrade screen explains it. You never lose what you have: looking, searching, backing up and restoring from the Bin always work.

## A box

- **Box number and label code**: the code printed on its QR label.
- **Contents**:
  - Type an item and tap **Add item** (or press Enter).
  - **×** next to an item moves it to the Bin.
- **Name**: for example "Kitchen 1".
- **Photos**: **Add photo** opens the camera or your photo library. Photos are shrunk to about 200 KB. Tap a photo to see it large, or to **Delete photo**. Free plan: 1 photo per box.
  - "Still downloading…": after a restore from Drive, the photo is on its way.
  - "This photo wasn't backed up": the photo didn't reach your backup before the phone was lost.
- **Room**: choose a room, or **New room…** to make one. **Rename room** fixes a room's name (for every box in it).
- **Where is it?**: for example "Garage, top shelf".
- **Notes**: anything else.
- **Fragile / Open first**: tap to switch on or off. They also print on the label.
- **Move** (Home mode): **Packed**, **Arrived** or **Unpacked**. Tap again to clear. Saves straight away.
- **Save**: saves name, where and notes. Rooms and the Fragile/Open first switches save straight away.
- **Move box to bin**: removes the box and its items. Restore it from the Bin within 30 days.
- **← (back)**: returns to your boxes.

## Bin

- Lists deleted boxes and deleted items, newest first.
- **Restore**: puts it back. After 30 days, things in the Bin are deleted for good.

## Scan

- Opens the camera. Point it at a BoxTap label.
  - **Your box**: it opens.
  - **Someone else's label**: "This box isn't in your BoxTap."
  - **Any other QR code**: "That code isn't a BoxTap label". It is never opened.
- If the camera is blocked, BoxTap explains how to allow it, with **Try again**.
- Scanning a label with the phone's own camera opens the label link. On Android this opens your box. On iPhone it opens Safari, which says "Open BoxTap and tap Scan", because the home-screen app keeps its own data.

## Settings

### Backup (a file you keep)

- **Last backup**: when you last saved a backup file.
- **Back up now**: makes an encrypted backup file, with your photos. On a phone, the share sheet opens: save it to Files, Google Drive or iCloud, or send it to yourself. On a computer, it downloads.
- **Set up backups**: only shown if this phone has no recovery code yet.
- **Restore from a backup file**: choose the file, type your 12 words, **Restore**. This replaces everything in BoxTap on this phone. With a wrong code, nothing changes.

### Google Drive backup

- **Connect Google Drive**: sign in with Google and allow Drive. BoxTap then keeps an encrypted copy in a "BoxTap Backup" folder in *your* Drive. Nobody can read it without your 12 words.
  - If your Drive already has a BoxTap backup, you choose:
    - **Restore it**: bring it to this phone.
    - **Start a new backup folder**: the old folder is renamed and left alone.
- **Status**: "Backed up to Google Drive · time", or "not backed up yet", plus the Google account.
- **Back up to Drive now**: saves a copy straight away, then sends waiting photos.
- **N photos waiting to upload**: photos go to Drive once each, encrypted. On Android they wait for Wi-Fi.
- **Changes not backed up · Tap to back up**: Google needs one tap each time you open the app (and after an hour) before BoxTap can save.
- While the app is open, BoxTap saves by itself about 2 minutes after your last change, at most every 15 minutes.
- **Messages you might see**:
  - Another device is now using the backup: this phone stops syncing.
  - The backup folder is in the Drive trash: use **Open Drive trash** to restore it.
  - Google storage is full.
  - The folder was deleted.
- **Disconnect Google Drive**: stops syncing. Your files stay in Drive; delete the folder there if you don't want them.

### Install BoxTap on this device

Shown until BoxTap is installed.
- **iPhone**: in Safari, tap Share, then **Add to Home Screen**, then **Add**, and open BoxTap from the new icon. Boxes added in a Safari tab don't move to the icon by themselves: back up in Safari, then restore in the installed app.
- **Android / computer**: tap **Install**, or use the browser menu → Install app.

### Your data

- **Export as spreadsheet (CSV)**: one row per item with its box, room, where, flags, move status and value. Opens in Excel or Google Sheets. Always free.
- **Erase all data**: deletes every box, item, photo and setting on this phone. It asks twice (the second time you type ERASE). Your Google Drive backup is kept; delete the "BoxTap Backup" folder in Drive yourself if you want it gone.

### Print labels

- **Label sheet**:
  - **Avery L7165**: 8 large labels per A4 sheet.
  - **Avery L7163**: 14 smaller labels per sheet.
- **Which labels**:
  - **All boxes**: one label per box, with number, name, room and Fragile/Open first.
  - **Blank spare labels**: labels with only a QR code, to stick on boxes later.
- **How many spare labels**: 1 to 200.
- **Start at label position**: skip labels already used on a part-used sheet. 1 is the top-left label, counting left to right, then down.
- **Make PDF**: makes the label PDF to print or save.
- Print at **100% / actual size**, not "fit to page", or the labels won't line up.

## Messages along the top

- **Private window**: your boxes will be deleted when you close it.
- **Not protected yet**: install BoxTap (Add to Home Screen) so the browser keeps your boxes.
- **This browser can't store BoxTap data**: anything you add is lost when you close the page.
- **New version available · Tap to update**: a newer BoxTap is ready. Your data stays.

## Not in the app yet

- Paid plans: entering a licence key, and payment links on the upgrade screen.
- Seller stock buttons (sell, restock, booked) and the catalogue image.
- "Use this device instead" when another phone has taken over the Drive backup.
