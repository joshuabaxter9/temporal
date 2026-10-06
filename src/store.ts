import fs from "node:fs";
import path from "node:path";
import { seedWaitlist } from "./seed";
import type { BookingRecord, TextMessage, WaitlistEntry } from "./types";

/**
 * A tiny JSON-file store standing in for the salon's booking system and SMS
 * provider. Both the API and the Worker read it, so it lives on disk rather
 * than in either process. Writes go through a temp file + rename so a reader
 * never sees a half-written file.
 */
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

const files = {
  waitlist: path.join(dataDir, "waitlist.json"),
  messages: path.join(dataDir, "messages.json"),
  bookings: path.join(dataDir, "bookings.json"),
};

function readJson<T>(file: string, fallback: () => T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const value = fallback();
    writeJson(file, value);
    return value;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

export const store = {
  getWaitlist(): WaitlistEntry[] {
    return readJson(files.waitlist, seedWaitlist);
  },
  removeFromWaitlist(candidateId: string): void {
    const waitlist = this.getWaitlist().filter((entry) => entry.id !== candidateId);
    writeJson(files.waitlist, waitlist);
  },
  getMessages(): TextMessage[] {
    return readJson<TextMessage[]>(files.messages, () => []);
  },
  appendMessage(message: TextMessage): void {
    writeJson(files.messages, [...this.getMessages(), message]);
  },
  getBookings(): BookingRecord[] {
    return readJson<BookingRecord[]>(files.bookings, () => []);
  },
  appendBooking(record: BookingRecord): void {
    writeJson(files.bookings, [...this.getBookings(), record]);
  },
  /** Restore the demo waitlist and clear the outbox and booking log. */
  reset(): void {
    writeJson(files.waitlist, seedWaitlist());
    writeJson(files.messages, []);
    writeJson(files.bookings, []);
  },
};
