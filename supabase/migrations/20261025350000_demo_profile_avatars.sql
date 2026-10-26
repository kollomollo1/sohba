-- Assign the generated, compact profile portraits to existing demo accounts.
-- Matching new accounts receive the same URL in manage-demo-accounts/index.ts.
update public.profiles
set avatar_url = case
  when substring(username from 6)::integer between 1 and 50 then
    '/demo-avatars/female_' || lpad(substring(username from 6), 3, '0') || '.jpg'
  else
    '/demo-avatars/male_' || lpad((substring(username from 6)::integer - 50)::text, 3, '0') || '.jpg'
end
where is_demo_account
  and username ~ '^demo_[0-9]{3}$'
  and substring(username from 6)::integer between 1 and 100;
