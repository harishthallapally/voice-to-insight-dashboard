import { NextResponse } from "next/server";
import { z } from "zod";

import { createSignupProfile } from "@/lib/signup-store";

export const runtime = "nodejs";

const passwordPattern =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
const mobileNumberPattern = /^\d{10}$/;

const signupRequestSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: z.string().trim().email(),
    mobileNumber: z.string().trim().regex(mobileNumberPattern),
    password: z.string().regex(passwordPattern),
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Password and confirm password must match.",
    path: ["confirmPassword"]
  });

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Signup failed.";
}

export async function POST(request: Request) {
  try {
    const parsedRequest = signupRequestSchema.safeParse(await request.json());

    if (!parsedRequest.success) {
      return NextResponse.json(
        {
          error:
            "Enter valid signup details. Email must be valid, mobile number must be 10 digits, and password must include one letter, one number, and one special character from ! @ # $ % ^ & *."
        },
        { status: 400 }
      );
    }

    const { confirmPassword: _confirmPassword, ...signupProfile } =
      parsedRequest.data;
    const signupResult = await createSignupProfile(signupProfile);

    if (!signupResult.created) {
      return NextResponse.json(
        { error: "This email is already registered." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      message: "Signup created successfully.",
      profile: signupResult.profile
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.startsWith("Missing required environment variable")
      ? 503
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
