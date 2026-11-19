# Product Hunt launch kit

Everything needed to put Tick on [Product Hunt](https://www.producthunt.com). Product Hunt is English-only, so the copy below is English. Facts come from the website copy (`docs/superpowers/specs/2026-11-09-website-copy.md`); don't promise more than the app does.

Limits (Product Hunt help, checked 2026-11-19): name ≤ 40 characters, tagline ≤ 60, description ≤ 260 (check the live form), up to 3 launch tags, thumbnail 240×240, gallery images 1270×760 and under 3 MB, at least 2 gallery images.

## Positioning

Product Hunt visitors are early adopters who compare every to-do app with Todoist, TickTick and Apple Reminders. "A reminder when you reach the shop" alone won't stand out there (other apps have it, and on iPhone Tick can't do it). So:

1. **Lead with sharing** (what is really different): one task together, or a copy for each with visible progress; shared lists with *Take it*.
2. **Place reminders as the Android bonus**, named honestly as Android-only (not "free on Android": that sounds as if iPhone pays).
3. **A touch of open source** for the tech crowd: host your own on a free Cloudflare account, set up with Claude Code, MCP server for Claude.

## 1. Before launch day

1. Create a **personal** Product Hunt account (real name, photo) at least a week ahead: new accounts usually have to wait about a week before they can post.
2. Comment on and upvote a few other launches in the weeks before, so the account isn't empty.
3. Check that signup on https://app.ticktodo.nl/signup works, that the Play link opens, and that the website says the same sharing limit as the app (3 people).
4. Create the post (*Submit* → *Launch a product*), choose **I made this**, fill in everything from sections 2–4, and **schedule** it. Don't launch on the spot.

Launches go live at 00:01 Pacific time = **09:01 in the Netherlands**. Tuesday–Thursday are busiest; a weekend day is quieter and easier to stand out on.

## 2. Product page

**Name:** Tick (if the form allows a longer name: "Tick To-Do", to avoid confusion with TickTick and Tick time tracking)

**Website:** https://ticktodo.nl/en/ (it opens with a demo you can try without an account)

**Tagline** (pick one):
1. `Shared to-do lists, with reminders at the right place` (53)
2. `Share to-dos your way: one task together, or a copy each` (56)

**Description** (252 characters):

> Tick is a free to-do app for the things you sort out with others. Share one task, or give each person their own copy and see their progress. On Android, Tick also reminds you when you reach the shop. No ads, no tracking, and open source: host your own.

**Launch tags:** Productivity · Task Management · Open Source

**Links** (extra links field):
- Web app: https://app.ticktodo.nl/signup
- Android (Google Play): https://play.google.com/store/apps/details?id=nl.ticktodo.app
- Source code: https://github.com/DioVayne/tick

**Pricing:** Free

## 3. Maker comment (post it right after going live)

> Hi Product Hunt 👋 I'm Dio. I made Tick because I needed an app that reminds me of things. One that just does what I want, and doesn't suddenly disappear or start costing money.
>
> My girlfriend (an ADD-powergirl) needed reminders at the right moment, not just at the right time: when she's at the shop, that's when she has to remember what to buy. That's where it started. Now we both use it every day, and she loves that I can send her a task and she can send me one. Things we sort out together don't get lost between us anymore.
>
> That's where Tick is different from most to-do apps:
> 👥 **Shared or copy.** Share a task as one task for both of you (done is done for everyone), or give the other person their own copy and see how far they are. Handy when you both have to do the same thing, like your tax return.
> 🙋 **Shared lists with "Take it".** Tap it and the others see you're on it. Ticked-off tasks show who did it and when.
> 📍 **Place reminders in the Android app.** A notification when you arrive at or leave a place. On iPhone you get reminders at a time, not at a place (Apple doesn't let a home-screen app do that).
> ⚡ **Tickmanager.** Old tasks come back one at a time: schedule, move to top, leave it or delete.
>
> It's free, without ads or tracking. The free version lets you share with up to 3 people, as many tasks and lists as you like.
>
> To be honest about money: I don't want to make a business out of Tick, but it shouldn't cost me money in the long run either. If hosting and sending mail get too expensive, I'll add paid extras to cover that. Nothing that's free when you sign up becomes paid without notice.
>
> And running Tick yourself will always stay free: it's open source (MIT), and you can put your own Tick on a free Cloudflare account in about 15 minutes with Claude Code. The built-in MCP server lets Claude manage your tasks too.
>
> It started as a little list for the two of us, and got a bit out of hand. I'd love to hear how you share to-dos with the people around you, and what you'd miss in Tick.

Ask for feedback, never for upvotes (that's against Product Hunt's rules), also not in messages to friends: share the link and say "I launched today, curious what you think".

## 4. Images

Ready to upload, in this folder:
- **Thumbnail:** `thumbnail-240.png` (the app icon).
- **Gallery** (1270×760, in this order; the first is also the preview when the link is shared):
  1. `gallery-1.png` — "One task together, or a copy for each" (share dialog + copy progress)
  2. `gallery-2.png` — "Share a list, see who takes what" (shared list, up to 3 people free)
  3. `gallery-3.png` — "Reminds you when you reach the shop", badge "In the Android app", with the iPhone note
  4. `gallery-4.png` — "On your phone and in your browser" (desktop web app)
  5. `gallery-5.png` — "Old tasks get a second chance" (Tickmanager)
  6. `gallery-6.png` — "Open source. Host your own." (Cloudflare, Claude Code, MCP, MIT)
- Optional: a short video or GIF of a place notification arriving.

To change them: edit `gallery.html` (it uses the raw app screens in `docs/screenshots/src/raw/`) and render each slide with headless Chrome, e.g. `chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files --virtual-time-budget=6000 --window-size=1270,760 --screenshot=gallery-1.png "file:///…/store/product-hunt/gallery.html#1"` (`#1` to `#6`).

## 5. On launch day

1. Post the maker comment as soon as the launch is live.
2. Share the link (LinkedIn, friends, the people already using Tick). Reply to every comment the same day.
3. Expect "how is this different from Apple Reminders / Todoist?": answer with shared vs copy and *Take it*, not with place reminders.
4. After launch: a Product Hunt badge on ticktodo.nl (NL + EN) is optional; it goes through the normal website rules in `CLAUDE.md`.
