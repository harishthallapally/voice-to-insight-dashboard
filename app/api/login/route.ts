import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyLogin } from "@/lib/signup-store";

export const runtime = "nodejs";

const passwordPattern =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;

const loginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().regex(passwordPattern)
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Login failed.";
}

export async function POST(request: Request) {
  try {
    const parsedRequest = loginRequestSchema.safeParse(await request.json());

    if (!parsedRequest.success) {
      return NextResponse.json(
        {
          error:
            "Enter registered email and valid password with one letter, one number, and one special character from ! @ # $ % ^ & *."
        },
        { status: 400 }
      );
    }

    const loginResult = await verifyLogin(parsedRequest.data);

    if (!loginResult.profile) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      message: "Login successful.",
      profile: loginResult.profile
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.startsWith("Missing required environment variable")
      ? 503
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
