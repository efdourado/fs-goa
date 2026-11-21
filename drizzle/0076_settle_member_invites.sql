UPDATE group_member_requests AS request
SET status = 'accepted', responded_at = now()
FROM group_members AS member
WHERE request.status = 'pending'
  AND member.group_id = request.group_id
  AND member.user_id = request.user_id
  AND member.removed_at IS NULL;
