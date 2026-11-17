# Graphics schedule

Each week, every design is due on Thursday. The final day is Friday.

Designers are added to a pool from the **Admin control panel**. The pool is shuffled across the designs each week so nobody is assigned the same design two weeks in a row. Admins can also reshuffle the rotation, clear progress, and change the PIN.

The schedule is shared: the Vercel deployment stores roster, assignments, and progress in a private Blob store via `/api/schedule`, and pages refresh from it every 5 seconds. The admin PIN is checked by the server and is never included in the client code. The GitHub Pages copy falls back to browser-local storage when the API is unavailable.
