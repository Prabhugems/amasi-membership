-- Migration: enforce uniqueness on ticket_number to prevent collisions
-- from concurrent inserts using Math.random()-based generation.
-- Run in Supabase Studio → SQL Editor.

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_ticket_number
  ON support_tickets (ticket_number);
