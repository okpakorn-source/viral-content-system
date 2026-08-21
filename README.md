This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## News pipeline release and rollback

- Create and push a recovery tag from the current `origin/main` immediately before a news-pipeline release.
- To restore the previous breakdown model without reverting code, set `MODEL_BREAKDOWN=gpt-5.5` in Vercel and redeploy.
- To bypass only the new full-RAW Sol audit during an incident, set `RAW_FACT_COMPLETENESS_GATE=0`; remove it or set `1` to restore the gate.
- `QUEUE_ATOMIC_CLAIM=0` is **not** a rollback for news jobs. News workers require the Supabase atomic claim path; disabling it makes news jobs ineligible for processing.
- A repeated news submission within the duplicate window reuses or reports the existing job instead of spending API credit again. Prefix the input with `ทำใหม่` when a genuinely new generation is required.
- If a code rollback is required, redeploy the recovery tag rather than copying local data files or test artifacts into the repository.
