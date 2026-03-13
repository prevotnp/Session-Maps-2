import type { Express } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { hashPassword, validateRequest } from "./utils";
import { getUncachableResendClient } from "../resend";
import { forgotPasswordSchema, resetPasswordSchema } from "@shared/schema";
import crypto, { randomBytes } from "crypto";
import { ZodError } from "zod";

export function registerAuthRoutes(app: Express) {
  // Password reset - request reset link
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);

      // Find user by email
      const user = await dbStorage.getUserByEmail(email);

      // Always return success to prevent email enumeration
      if (!user) {
        return res.status(200).json({
          message: "If an account with that email exists, you will receive a password reset link."
        });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

      // Save token to database
      await dbStorage.createPasswordResetToken(user.id, token, expiresAt);

      // Build reset URL
      const baseUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production'
        ? 'https://www.sessionmaps.com'
        : 'http://localhost:5000');
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        await resend.emails.send({
          from: fromEmail || 'Session Maps <noreply@sessionmaps.com>',
          to: [email],
          subject: 'Reset Your Session Maps Password',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 24px; font-weight: 700; color: #1e293b; margin: 0;">Session Maps</h1>
              </div>
              <h2 style="font-size: 20px; font-weight: 600; color: #1e293b; margin-bottom: 16px;">Reset Your Password</h2>
              <p style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
                We received a request to reset the password for your Session Maps account. Click the button below to create a new password.
              </p>
              <div style="text-align: center; margin-bottom: 24px;">
                <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
                  Reset Password
                </a>
              </div>
              <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 16px;">
                This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.
              </p>
              <p style="font-size: 12px; color: #cbd5e1; line-height: 1.5;">
                If the button doesn't work, copy and paste this link into your browser:<br/>
                <a href="${resetUrl}" style="color: #60a5fa; word-break: break-all;">${resetUrl}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 11px; color: #cbd5e1; text-align: center;">
                &copy; ${new Date().getFullYear()} Session Maps &middot; sessionmaps.com
              </p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
      }

      return res.status(200).json({
        message: "If an account with that email exists, you will receive a password reset link."
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Forgot password error:", error);
      return res.status(500).json({ message: "Error processing password reset request" });
    }
  });

  // Password reset - verify token and reset password
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);

      // Find the token
      const resetToken = await dbStorage.getPasswordResetToken(token);

      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }

      // Check if token is expired
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ message: "Reset link has expired. Please request a new one." });
      }

      // Check if token was already used
      if (resetToken.used) {
        return res.status(400).json({ message: "This reset link has already been used" });
      }

      // Hash new password using same scrypt method as registration
      const hashedPassword = await hashPassword(password);

      // Update user's password
      const updatedUser = await dbStorage.updateUserPassword(resetToken.userId, hashedPassword);

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Mark token as used
      await dbStorage.markPasswordResetTokenUsed(resetToken.id);

      return res.status(200).json({ message: "Password reset successfully. You can now log in with your new password." });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Error resetting password" });
    }
  });

  // Verify reset token (for frontend to check if token is valid before showing form)
  app.get("/api/auth/verify-reset-token/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const resetToken = await dbStorage.getPasswordResetToken(token);

      if (!resetToken) {
        return res.status(400).json({ valid: false, message: "Invalid reset link" });
      }

      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ valid: false, message: "Reset link has expired" });
      }

      if (resetToken.used) {
        return res.status(400).json({ valid: false, message: "Reset link has already been used" });
      }

      return res.status(200).json({ valid: true });
    } catch (error) {
      console.error("Verify reset token error:", error);
      return res.status(500).json({ valid: false, message: "Error verifying reset token" });
    }
  });

  // Subscription routes
  app.post("/api/subscription/purchase", isAuthenticated, async (req, res) => {
    return res.status(501).json({
      message: "Subscriptions are coming soon. Payment integration is not yet available."
    });
  });

  app.get("/api/subscription/status", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      const userDetails = await dbStorage.getUser(user.id);
      if (!userDetails) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.status(200).json({
        isSubscribed: userDetails.isSubscribed,
        expiryDate: userDetails.subscriptionExpiry
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching subscription status" });
    }
  });
}
