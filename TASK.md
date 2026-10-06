Background
Lena runs Juniper Salon, a neighborhood hair salon where last-minute cancellations can leave unexpected gaps in the schedule. When an appointment opens, Lena and her staff currently use a spreadsheet and text messages to contact clients who previously asked for an earlier appointment. Managing those conversations by hand takes time and makes it difficult to keep track of what is happening.

Your job is to understand Lena's goals for improving this process, including how it should work for staff and clients, what can go wrong, and what matters most to her business. You will then create and present a working prototype that addresses those needs and uses Temporal meaningfully.

FLOW:
The employees should be able to enter an opening the system should be able to search through a waitlist, message potential people to fill the slot, get an answer, update the system.

Words from LENA:

"You: So the system will not detect newly avaible slots but just be given a slot and attempt to find someone to fill
Lena: Right. Staff would enter the opening, and the system would handle the matching and offers from there.
You: Do you offer the slot to one client at a time (first in line, wait, then next) or several at once '
Lena: I’d prefer sending it to several at once because that seems fastest. But I don’t want competing acceptances or double-booking. For a same-day opening, give them 15 minutes to respond, then move to the next person. I haven’t decided whether that should differ for appointments several days away."

"You: What's the single most annoying or time-consuming part of doing this by hand?
Lena: Keeping track of who we already contacted and who declined or timed out. When things get busy, we can forget to move to the next person and the chair stays empty."

"You: Is there anything you'd explicitly not want automated — moments where a human should stay in the loop?
Lena: Staff should enter the opening and be able to cancel an offer if the original client changes their mind or the stylist becomes unavailable. They should also monitor the status."

"You: What do you and your staff need to see at a glance — which gaps are open, who's been offered what, who's been asked and hasn't answered?
Lena: We need to see the open appointment, the current offer holder, and which earlier people declined or timed out. It should also show the remaining candidates and the final result."

"You: How do clients reply — text back "YES", tap a link, call? What exact wording do you want them to see? What if a client replies after their window expired and the slot's already gone? What should they hear?
Lena: A text with a link to accept or decline would be easiest. I haven’t decided on the exact wording. If they respond after it expires, they should see that the opening is no longer available."

context(for reschudling before same day): Lena: You can come up with a reasonable solution. I mainly want it to keep moving without creating competing acceptances."

IMPORTANT:

It must move to the next eligible person automatically when an offer expires or is declined. It also must prevent two clients from claiming the same opening.
