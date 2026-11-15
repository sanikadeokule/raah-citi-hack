import os

# several teacher numbers so tests don't hit the per-phone OTP rate limit
os.environ["RAAH_TEACHER_PHONES"] = "9000000001,9000000002,9000000003"
