import type { WaitlistEntry } from "./types";

export const STYLISTS = ["Lena", "Marco", "Priya"] as const;

export const SERVICES: Array<{ name: string; durationMinutes: number }> = [
  { name: "Haircut", durationMinutes: 45 },
  { name: "Blowout", durationMinutes: 30 },
  { name: "Color", durationMinutes: 90 },
  { name: "Trim", durationMinutes: 20 },
];

function daysFromNow(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Clients who already hold an appointment but asked to be contacted if
 * something earlier opens up. Ordered here roughly by when they asked;
 * the search sorts by requestedAt so first-to-ask is first-to-be-offered.
 */
export function seedWaitlist(): WaitlistEntry[] {
  return [
    {
      id: "c-ava",
      name: "Ava Chen",
      phone: "+1 555 0101",
      service: "Haircut",
      durationMinutes: 45,
      preferredStylist: "Lena",
      currentAppointmentAt: daysFromNow(14, 10),
      requestedAt: daysAgo(9),
    },
    {
      id: "c-ben",
      name: "Ben Okafor",
      phone: "+1 555 0102",
      service: "Trim",
      durationMinutes: 20,
      preferredStylist: null,
      currentAppointmentAt: daysFromNow(10, 15),
      requestedAt: daysAgo(8),
    },
    {
      id: "c-chloe",
      name: "Chloe Dubois",
      phone: "+1 555 0103",
      service: "Color",
      durationMinutes: 90,
      preferredStylist: "Priya",
      currentAppointmentAt: daysFromNow(21, 13),
      requestedAt: daysAgo(7),
    },
    {
      id: "c-dev",
      name: "Dev Patel",
      phone: "+1 555 0104",
      service: "Haircut",
      durationMinutes: 45,
      preferredStylist: null,
      currentAppointmentAt: daysFromNow(12, 11),
      requestedAt: daysAgo(6),
    },
    {
      id: "c-emma",
      name: "Emma Rossi",
      phone: "+1 555 0105",
      service: "Blowout",
      durationMinutes: 30,
      preferredStylist: "Marco",
      currentAppointmentAt: daysFromNow(9, 16),
      requestedAt: daysAgo(5),
    },
    {
      id: "c-finn",
      name: "Finn Walsh",
      phone: "+1 555 0106",
      service: "Haircut",
      durationMinutes: 45,
      preferredStylist: "Lena",
      currentAppointmentAt: daysFromNow(2, 9),
      requestedAt: daysAgo(4),
    },
    {
      id: "c-grace",
      name: "Grace Kim",
      phone: "+1 555 0107",
      service: "Trim",
      durationMinutes: 20,
      preferredStylist: null,
      currentAppointmentAt: daysFromNow(18, 14),
      requestedAt: daysAgo(3),
    },
    {
      id: "c-hugo",
      name: "Hugo Alvarez",
      phone: "+1 555 0108",
      service: "Haircut",
      durationMinutes: 45,
      preferredStylist: "Marco",
      currentAppointmentAt: daysFromNow(16, 12),
      requestedAt: daysAgo(1),
    },
  ];
}
