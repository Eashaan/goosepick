

## Plan: Multi-Admin Management by Email

### Current State
- One admin exists (`eashaanb@gmail.com`)
- `user_roles` table has deny-all client-side write policies (INSERT/UPDATE/DELETE = false) — correct for security
- Admin writes must go through a service-role edge function

### Implementation

**Task 1: Create `manage-admins` edge function**
- Accepts actions: `list`, `add` (by email), `remove` (by user_id)
- Validates caller is an existing admin via service role
- For `add`: looks up `auth.users` by email, inserts into `user_roles` with role='admin'
- For `remove`: prevents self-removal, deletes from `user_roles`
- Returns list of current admins (email + user_id)

**Task 2: Create Admin Management UI component**
- New `AdminManagement` dialog/sheet accessible from AdminDashboard (gear icon or "Manage Admins" button)
- Shows list of current admins with their emails
- "Add Admin" input: enter email → calls edge function → shows success/error
- "Remove" button next to each admin (disabled for self) → confirmation → calls edge function
- Note: the email must belong to an existing auth user (they must have signed up first)

**Task 3: Wire into AdminDashboard**
- Add a "Manage Admins" button in the dashboard header area (visible only to logged-in admins)
- Opens the management dialog

### Files to create/modify:
1. **New**: `supabase/functions/manage-admins/index.ts`
2. **New**: `src/components/admin/AdminManagement.tsx`
3. **Edit**: `src/pages/admin/AdminDashboard.tsx` — add button to open admin management
4. **Edit**: `supabase/config.toml` — register the function

