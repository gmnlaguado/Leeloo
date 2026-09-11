import Foundation
import Intents

// LeelooSiriModule — donates NSUserActivity-based Siri Shortcuts.
// "Hey Siri, Leeloo" → iOS opens Leeloo app → deep link leeloo://voice fires.
//
// Registered as a NativeModule (not an Expo Module) to keep it lightweight
// and avoid requiring expo-modules-core native linking for this small feature.

@objc(LeelooSiri)
class LeelooSiriModule: NSObject {

  // MARK: – Donate shortcut (silent, called on first launch)

  @objc func donateShortcut(
    _ phrase: String,
    activityType: String,
    title: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let activity = self.buildActivity(type: activityType, title: title, phrase: phrase)
      // Becoming/resigning current donates to Siri's prediction engine
      activity.becomeCurrent()
      // Store activity reference so it isn't deallocated before donation completes
      self.currentActivity = activity
      resolve(nil)
    }
  }

  // MARK: – Present "Add to Siri" sheet (called from onboarding)

  @objc func presentAddToSiri(
    _ phrase: String,
    activityType: String,
    title: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let rootVC = UIApplication.shared
        .connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController })
        .first else {
        reject("NO_VC", "No root view controller found", nil)
        return
      }

      let activity = self.buildActivity(type: activityType, title: title, phrase: phrase)
      let shortcut = INShortcut(userActivity: activity)
      let vc = INUIAddVoiceShortcutViewController(shortcut: shortcut)
      vc.delegate = self
      self.pendingResolve = resolve
      self.pendingReject = reject
      rootVC.present(vc, animated: true)
    }
  }

  // MARK: – Check if already donated

  @objc func isShortcutDonated(
    _ activityType: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    INVoiceShortcutCenter.shared.getAllVoiceShortcuts { shortcuts, error in
      if let _ = error {
        resolve(false)
        return
      }
      let donated = shortcuts?.contains { shortcut in
        shortcut.shortcut.userActivity?.activityType == activityType
      } ?? false
      resolve(donated)
    }
  }

  // MARK: – Helpers

  private var currentActivity: NSUserActivity?
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?

  private func buildActivity(type: String, title: String, phrase: String) -> NSUserActivity {
    let activity = NSUserActivity(activityType: type)
    activity.title = title
    activity.suggestedInvocationPhrase = phrase
    activity.isEligibleForSearch = true
    activity.isEligibleForPrediction = true
    activity.persistentIdentifier = NSUserActivityPersistentIdentifier(type)
    // Pass deep link so the app opens in voice mode when Siri fires it
    activity.userInfo = ["deepLink": "leeloo://voice"]
    return activity
  }

  // MARK: – Module boilerplate

  @objc static func requiresMainQueueSetup() -> Bool { return true }
}

// MARK: – INUIAddVoiceShortcutViewControllerDelegate

extension LeelooSiriModule: INUIAddVoiceShortcutViewControllerDelegate {

  func addVoiceShortcutViewController(
    _ controller: INUIAddVoiceShortcutViewController,
    didFinishWith voiceShortcut: INVoiceShortcut?,
    error: Error?
  ) {
    controller.dismiss(animated: true) {
      if voiceShortcut != nil {
        self.pendingResolve?("added")
      } else {
        self.pendingResolve?("cancelled")
      }
      self.pendingResolve = nil
      self.pendingReject = nil
    }
  }

  func addVoiceShortcutViewControllerDidCancel(
    _ controller: INUIAddVoiceShortcutViewController
  ) {
    controller.dismiss(animated: true) {
      self.pendingResolve?("cancelled")
      self.pendingResolve = nil
      self.pendingReject = nil
    }
  }
}
