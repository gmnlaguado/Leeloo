#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LeelooSiri, NSObject)

RCT_EXTERN_METHOD(donateShortcut:(NSString *)phrase
                  activityType:(NSString *)activityType
                  title:(NSString *)title
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(presentAddToSiri:(NSString *)phrase
                  activityType:(NSString *)activityType
                  title:(NSString *)title
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isShortcutDonated:(NSString *)activityType
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
