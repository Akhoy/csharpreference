---
id: security-story
title: "Part XII as One Story: Kettle Gets Attacked"
summary: "Read this first. A security researcher emails Kettle: by changing a number in a URL, they can read any customer's order. Part XII looks at Kettle the way an attacker would, then replaces Kettle's home-made login with a proper identity provider. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: cross
where: Security › Start of Part XII
fits: "The doorway into Part XII, Security. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: performance-engineering
next: web-security
---

## The 30-second version

- Part XII looks at Kettle the way an attacker would, then replaces Kettle's home-made login with a proper identity provider.
- 2 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

A security researcher emails Kettle: by changing a number in a URL, they can read any customer's order. Part XII looks at Kettle the way an attacker would, then replaces Kettle's home-made login with a proper identity provider.

## The road through Part XII {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Think like an attacker](ch:web-security) | Change the number in /orders/41 and you can read a stranger's order. | The OWASP risks, access control, injection, XSS and CSRF, and safe file uploads |
| 2 | [Signing in without passwords](ch:oauth-oidc-identity) | Kettle shouldn't store passwords at all. Let an identity provider do it. | OAuth 2.0, OpenID Connect, PKCE, token validation and the BFF pattern |

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where the shop is, in two or three sentences.
2. **The problem.** The thing that just broke, or got slow, or got dangerous.
3. **The chapter itself.** Plain-words summaries first, then the mechanics, then in-depth sections and interview questions for when you need them.
4. **Next episode.** The new problem the fix uncovered, which is where the next chapter starts.

:::tip Watch it first
The [Kettle Storybook](story.html) has a short animated scene for every episode in this part. Watching the scene before reading the chapter takes two minutes and gives you the picture the text then fills in.
:::

## Where this part ends {b}

By the end of Part XII, Kettle has been built, scaled, operated and secured. Part XIII is about telling that story well in an interview.

[Start: Episode 1 · Think like an attacker →](ch:web-security)
