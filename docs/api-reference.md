# Meal Direct API Reference & Request Shapes

This document provides the exact shapes of queries, request bodies, parameters, and responses for the Meal Direct API, parsed from [openapi.json](file:///c:/sulvatech/mealdirectbackend/docs/openapi.json).

## health Endpoints

### `GET /v1/health/live`

#### Responses

- **Status 200**: The API process is running.

---

### `GET /v1/health/ready`

#### Responses

- **Status 200**: The API is ready to serve traffic.
- **Status 503**: A required dependency is unavailable.

---

## operations Endpoints

### `GET /v1/operations/status`

#### Responses

- **Status 200**: Internal operational status for authorized administrators.
- **Status 401**: Operations token missing or invalid.

---

## auth Endpoints

### `POST /v1/auth/customer/signup`

#### Responses

- **Status 201**: Customer registered successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 400**: Registration failed due to invalid input or duplicate email.

---

### `POST /v1/auth/customer/login`

#### Responses

- **Status 200**: Customer logged in successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 401**: Invalid credentials.
- **Status 403**: Incorrect role.

---

### `POST /v1/auth/vendor/signup`

#### Responses

- **Status 201**: Vendor registered successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 400**: Registration failed.

---

### `POST /v1/auth/vendor/login`

#### Responses

- **Status 200**: Vendor logged in successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 401**: Invalid credentials.
- **Status 403**: Incorrect role.

---

### `POST /v1/auth/rider/signup`

#### Responses

- **Status 201**: Rider registered successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 400**: Registration failed.

---

### `POST /v1/auth/rider/login`

#### Responses

- **Status 200**: Rider logged in successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 401**: Invalid credentials.
- **Status 403**: Incorrect role.

---

### `POST /v1/auth/admin/login`

#### Responses

- **Status 200**: Admin logged in successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 401**: Invalid credentials.
- **Status 403**: Incorrect role.

---

### `POST /v1/auth/refresh`

#### Responses

- **Status 200**: Session refreshed successfully.
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "[object Object]",
    "message": "string"
  }
  ```
- **Status 401**: Invalid refresh token.

---

### `POST /v1/auth/logout`

#### Responses

- **Status 200**: Logged out successfully.
- **Status 401**: Invalid or missing bearer token.

---

### `GET /v1/auth/me`

#### Responses

- **Status 200**: The authenticated Meal Direct actor context.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

## me Endpoints

### `GET /v1/me`

#### Responses

- **Status 200**: Current role-aware Meal Direct session.
  ```json
  {
    "data": {
      "actor": {
        "userId": "string",
        "role": "string",
        "email": "string",
        "campusId": "string",
        "vendorId": "string",
        "riderId": "string"
      },
      "profile": {
        "id": "string",
        "email": "string",
        "displayName": "string",
        "phoneNumber": "string",
        "avatarUrl": "string",
        "accountStatus": "string",
        "defaultCampusId": "string",
        "defaultLocationId": "string",
        "onboardingCompletedAt": "string",
        "onboardingCompleted": "boolean",
        "lastSeenAt": "string",
        "createdAt": "string",
        "updatedAt": "string"
      },
      "roles": "Array<string>",
      "campuses": "Array<[object Object]>",
      "vendorMemberships": "Array<[object Object]>",
      "riderProfiles": "Array<[object Object]>",
      "adminMemberships": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `PATCH /v1/me`

#### Responses

- **Status 200**: Updated safe profile fields.
  ```json
  {
    "data": {
      "id": "string",
      "email": "string",
      "displayName": "string",
      "phoneNumber": "string",
      "avatarUrl": "string",
      "accountStatus": "string",
      "defaultCampusId": "string",
      "defaultLocationId": "string",
      "onboardingCompletedAt": "string",
      "onboardingCompleted": "boolean",
      "lastSeenAt": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid profile input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `GET /v1/me/campuses`

#### Responses

- **Status 200**: Active campus memberships for the current user.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `POST /v1/me/complete-onboarding`

#### Responses

- **Status 200**: Profile after onboarding completion.
  ```json
  {
    "data": {
      "id": "string",
      "email": "string",
      "displayName": "string",
      "phoneNumber": "string",
      "avatarUrl": "string",
      "accountStatus": "string",
      "defaultCampusId": "string",
      "defaultLocationId": "string",
      "onboardingCompletedAt": "string",
      "onboardingCompleted": "boolean",
      "lastSeenAt": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid onboarding input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: User does not belong to the selected campus.

---

### `PUT /v1/me/default-location`

#### Responses

- **Status 200**: Profile after default location update.
  ```json
  {
    "data": {
      "id": "string",
      "email": "string",
      "displayName": "string",
      "phoneNumber": "string",
      "avatarUrl": "string",
      "accountStatus": "string",
      "defaultCampusId": "string",
      "defaultLocationId": "string",
      "onboardingCompletedAt": "string",
      "onboardingCompleted": "boolean",
      "lastSeenAt": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid default location input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: User does not belong to the selected campus.

---

## campuses Endpoints

### `GET /v1/campuses`

#### Responses

- **Status 200**: Active campuses available to public clients.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```

---

### `GET /v1/campuses/{campusId}/locations`

#### Responses

- **Status 200**: Active preset delivery locations for a campus.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid campus ID.

---

### `GET /v1/campuses/{campusId}/delivery-slots`

#### Responses

- **Status 200**: Active delivery slots for a campus, optionally with date cutoffs.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid campus ID or date filter.

---

## admin-campuses Endpoints

### `GET /v1/admin/campuses`

#### Responses

- **Status 200**: Admin-visible campuses.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/campuses`

#### Responses

- **Status 200**: Created campus.
  ```json
  {
    "data": {
      "id": "string",
      "name": "string",
      "slug": "string",
      "timezone": "string",
      "currency": "string",
      "countryCode": "string",
      "active": "boolean",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid campus input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `PATCH /v1/admin/campuses/{campusId}`

#### Responses

- **Status 200**: Updated campus.
  ```json
  {
    "data": {
      "id": "string",
      "name": "string",
      "slug": "string",
      "timezone": "string",
      "currency": "string",
      "countryCode": "string",
      "active": "boolean",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid campus input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/campuses/{campusId}/zones`

#### Responses

- **Status 200**: Campus zones for admins.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/campuses/{campusId}/zones`

#### Responses

- **Status 200**: Created campus zone.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "name": "string",
      "code": "string",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `PATCH /v1/admin/zones/{zoneId}`

#### Responses

- **Status 200**: Updated campus zone.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "name": "string",
      "code": "string",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/campuses/{campusId}/locations`

#### Responses

- **Status 200**: Campus locations for admins.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/campuses/{campusId}/locations`

#### Responses

- **Status 200**: Created campus location.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "zoneId": "string",
      "zoneName": "string",
      "zoneCode": "string",
      "name": "string",
      "slug": "string",
      "type": "string",
      "deliveryInstructions": "string",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `PATCH /v1/admin/locations/{locationId}`

#### Responses

- **Status 200**: Updated campus location.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "zoneId": "string",
      "zoneName": "string",
      "zoneCode": "string",
      "name": "string",
      "slug": "string",
      "type": "string",
      "deliveryInstructions": "string",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/campuses/{campusId}/delivery-slots`

#### Responses

- **Status 200**: Campus delivery slots for admins.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/campuses/{campusId}/delivery-slots`

#### Responses

- **Status 200**: Created campus delivery slot.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "name": "string",
      "deliveryTime": "string",
      "cutoffMinutes": "number",
      "active": "boolean",
      "displayOrder": "number",
      "orderingCutoffAt": "string",
      "acceptingOrders": "boolean",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `PATCH /v1/admin/delivery-slots/{slotId}`

#### Responses

- **Status 200**: Updated campus delivery slot.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "name": "string",
      "deliveryTime": "string",
      "cutoffMinutes": "number",
      "active": "boolean",
      "displayOrder": "number",
      "orderingCutoffAt": "string",
      "acceptingOrders": "boolean",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

## vendor Endpoints

### `GET /v1/vendor/profile`

#### Responses

- **Status 200**: Current vendor profile and approval state.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "legalName": "string",
      "displayName": "string",
      "slug": "string",
      "description": "string",
      "phone": "string",
      "email": "string",
      "logoUrl": "string",
      "kitchenLocation": "string",
      "status": "string",
      "active": "boolean",
      "defaultDeliveryMode": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `PATCH /v1/vendor/profile`

#### Request Body Shape

```json
{
  "displayName": "string",
  "description": "string",
  "phone": "string",
  "email": "string",
  "logoUrl": "string",
  "kitchenLocation": "string",
  "defaultDeliveryMode": "string"
}
```

#### Responses

- **Status 200**: Updated safe vendor profile fields.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "legalName": "string",
      "displayName": "string",
      "slug": "string",
      "description": "string",
      "phone": "string",
      "email": "string",
      "logoUrl": "string",
      "kitchenLocation": "string",
      "status": "string",
      "active": "boolean",
      "defaultDeliveryMode": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid vendor profile input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/payout-account`

#### Responses

- **Status 200**: Current masked payout account snapshot, if configured.
  ```json
  {
    "data": "Object"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `PUT /v1/vendor/payout-account`

#### Request Body Shape

```json
{
  "bankName": "string",
  "bankCode": "string",
  "accountName": "string",
  "accountNumber": "string",
  "paystackRecipientCode": "string"
}
```

#### Responses

- **Status 200**: Replaces the active payout account with a masked snapshot.
  ```json
  {
    "data": "Object"
  }
  ```
- **Status 400**: Invalid payout account input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/menu-metadata`

#### Responses

- **Status 200**: Vendor menu categories and active unit types.
  ```json
  {
    "data": {
      "categories": "Array<[object Object]>",
      "unitTypes": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/menu-items`

#### Responses

- **Status 200**: Vendor-owned menu items including inactive historical items.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `POST /v1/vendor/menu-items`

#### Request Body Shape

```json
{
  "categoryId": "string",
  "unitTypeId": "string",
  "name": "string",
  "description": "string",
  "imageUrl": "string",
  "priceKobo": "number",
  "displayOrder": "number"
}
```

#### Responses

- **Status 201**: Created vendor-owned menu item.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "name": "string",
      "description": "string",
      "imageUrl": "string",
      "priceKobo": "number",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid menu item input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/menu-items/{itemId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Responses

- **Status 200**: Vendor-owned menu item detail.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "name": "string",
      "description": "string",
      "imageUrl": "string",
      "priceKobo": "number",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Menu item was not found for this vendor.

---

### `PATCH /v1/vendor/menu-items/{itemId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Request Body Shape

```json
{
  "categoryId": "string",
  "unitTypeId": "string",
  "name": "string",
  "description": "string",
  "imageUrl": "string",
  "priceKobo": "number",
  "displayOrder": "number"
}
```

#### Responses

- **Status 200**: Updated vendor-owned menu item safe fields.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "name": "string",
      "description": "string",
      "imageUrl": "string",
      "priceKobo": "number",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid menu item input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Menu item was not found for this vendor.

---

### `POST /v1/vendor/menu-items/{itemId}/activate`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Responses

- **Status 200**: Activated a vendor-owned menu item.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "name": "string",
      "description": "string",
      "imageUrl": "string",
      "priceKobo": "number",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `POST /v1/vendor/menu-items/{itemId}/deactivate`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Responses

- **Status 200**: Deactivated a vendor-owned menu item without deleting history.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "name": "string",
      "description": "string",
      "imageUrl": "string",
      "priceKobo": "number",
      "active": "boolean",
      "displayOrder": "number",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/menu-items/{itemId}/schedules`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Responses

- **Status 200**: Current slot availability for a vendor-owned menu item.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `PUT /v1/vendor/menu-items/{itemId}/schedules`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `itemId`  | `string` | Yes      |             |

#### Request Body Shape

```json
{
  "entries": "Array<[object Object]>"
}
```

#### Responses

- **Status 200**: Replaced slot availability for a vendor-owned menu item.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid menu item schedule input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/availability`

#### Responses

- **Status 200**: Vendor operating availability by delivery slot and day of week.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `PUT /v1/vendor/availability`

#### Request Body Shape

```json
{
  "entries": "Array<[object Object]>"
}
```

#### Responses

- **Status 200**: Replaced vendor operating availability by slot and day.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid vendor availability input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

## vendor-orders Endpoints

### `GET /v1/vendor/orders`

#### Responses

- **Status 200**: List of orders placed with the authenticated vendor.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid query filters.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/orders/{orderId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Detailed summary of a single vendor order, including items.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Order not found for this vendor.

---

### `POST /v1/vendor/orders/{orderId}/accept`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order accepted by the vendor.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```
- **Status 400**: Invalid order transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Order not found for this vendor.

---

### `POST /v1/vendor/orders/{orderId}/prepare`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order preparation started by the vendor.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```
- **Status 400**: Invalid order transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Order not found for this vendor.

---

### `POST /v1/vendor/orders/{orderId}/preparing`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order preparation started by the vendor.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```
- **Status 400**: Invalid order transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Order not found for this vendor.

---

### `POST /v1/vendor/orders/{orderId}/ready`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order marked ready for pickup by the vendor.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```
- **Status 400**: Invalid order transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Order not found for this vendor.

---

## catalog Endpoints

### `GET /v1/catalog/vendors`

#### Responses

- **Status 200**: Approved active vendors available for the selected campus/date/slot.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid catalog filters.

---

### `GET /v1/catalog/vendors/{vendorId}`

#### Responses

- **Status 200**: Approved active vendor detail.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "displayName": "string",
      "slug": "string",
      "description": "string",
      "logoUrl": "string",
      "kitchenLocation": "string",
      "defaultDeliveryMode": "string"
    }
  }
  ```
- **Status 400**: Invalid vendor ID.
- **Status 404**: Vendor not found or unavailable.

---

### `GET /v1/catalog/vendors/{vendorId}/menu`

#### Responses

- **Status 200**: Approved active menu items for the vendor.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid vendor ID or menu filters.

---

## vendor-inventory Endpoints

### `GET /v1/vendor/inventory`

#### Responses

- **Status 200**: Vendor-owned dated inventory for a service date and optional delivery slot.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid inventory filters.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `PUT /v1/vendor/inventory/{inventoryId}`

#### Path Parameters

| Parameter     | Type     | Required | Description |
| :------------ | :------- | :------- | :---------- |
| `inventoryId` | `string` | Yes      |             |

#### Request Body Shape

```json
{
  "quantityTotal": "number",
  "expectedVersion": "number"
}
```

#### Responses

- **Status 200**: Updates the editable starting quantity for a vendor-owned inventory row.
  ```json
  {
    "data": {
      "id": "string",
      "vendorId": "string",
      "menuItemId": "string",
      "menuItemName": "string",
      "categoryId": "string",
      "categoryName": "string",
      "unitTypeId": "string",
      "unitCode": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "quantityTotal": "number",
      "quantityReserved": "number",
      "quantitySold": "number",
      "quantityAdjusted": "number",
      "remainingQuantity": "number",
      "active": "boolean",
      "version": "number",
      "createdAt": "string",
      "updatedAt": "string",
      "adjustments": "Array<[object Object]>"
    }
  }
  ```
- **Status 400**: Invalid inventory quantity or stale state.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Inventory row was not found for this vendor.

---

### `POST /v1/vendor/inventory/{inventoryId}/adjustments`

#### Path Parameters

| Parameter     | Type     | Required | Description |
| :------------ | :------- | :------- | :---------- |
| `inventoryId` | `string` | Yes      |             |

#### Request Body Shape

```json
{
  "adjustmentQuantity": "number",
  "reason": "string",
  "metadata": "Object"
}
```

#### Responses

- **Status 201**: Records an append-only vendor inventory adjustment.
  ```json
  {
    "data": {
      "adjustment": {
        "id": "string",
        "inventoryId": "string",
        "adjustmentQuantity": "number",
        "reason": "string",
        "actorUserId": "string",
        "metadata": "Object",
        "createdAt": "string"
      },
      "inventory": {
        "id": "string",
        "vendorId": "string",
        "menuItemId": "string",
        "menuItemName": "string",
        "categoryId": "string",
        "categoryName": "string",
        "unitTypeId": "string",
        "unitCode": "string",
        "serviceDate": "string",
        "deliverySlotId": "string",
        "deliverySlotName": "string",
        "quantityTotal": "number",
        "quantityReserved": "number",
        "quantitySold": "number",
        "quantityAdjusted": "number",
        "remainingQuantity": "number",
        "active": "boolean",
        "version": "number",
        "createdAt": "string",
        "updatedAt": "string",
        "adjustments": "Array<[object Object]>"
      }
    }
  }
  ```
- **Status 400**: Invalid inventory adjustment.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Inventory row was not found for this vendor.

---

## orders Endpoints

### `POST /v1/orders/quote`

#### Responses

- **Status 200**: Order quote using current menu and slot availability.
  ```json
  {
    "data": {
      "currency": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "items": "Array<[object Object]>"
    }
  }
  ```

---

### `GET /v1/orders`

#### Responses

- **Status 200**: Customer order history.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```

---

### `POST /v1/orders`

#### Responses

- **Status 201**: Order was created idempotently and inventory was reserved.

---

### `GET /v1/orders/{orderId}/payment-status`

#### Responses

- **Status 200**: Customer-visible payment status for an order.
  ```json
  {
    "data": {
      "orderId": "string",
      "orderStatus": "string",
      "payment": "Object"
    }
  }
  ```

---

### `POST /v1/orders/{orderId}/confirm-delivery`

#### Responses

- **Status 200**: Customer delivery confirmation.
  ```json
  {
    "data": {
      "confirmationId": "string"
    }
  }
  ```

---

### `GET /v1/orders/{orderId}`

#### Responses

- **Status 200**: Customer-owned order detail.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object"
    }
  }
  ```

---

## payments Endpoints

### `POST /v1/orders/{orderId}/payments/paystack/initialize`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Paystack checkout initialization for a customer-owned pending order.
  ```json
  {
    "data": {
      "paymentId": "string",
      "authorizationUrl": "string",
      "accessCode": "string",
      "reference": "string"
    }
  }
  ```
- **Status 400**: Invalid order or payment state.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `POST /v1/payments/webhooks/paystack`

#### Responses

- **Status 202**: Paystack webhook was verified and accepted idempotently.
- **Status 401**: Missing or invalid Paystack signature.

---

## admin-payments Endpoints

### `GET /v1/admin/payments`

#### Responses

- **Status 200**: Admin-visible payment records scoped by campus for campus admins.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/payments/{paymentId}`

#### Path Parameters

| Parameter   | Type     | Required | Description |
| :---------- | :------- | :------- | :---------- |
| `paymentId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Admin-visible payment detail scoped by campus for campus admins.
  ```json
  {
    "data": {
      "id": "string",
      "orderId": "string",
      "orderNumber": "string",
      "customerId": "string",
      "customerEmail": "string",
      "campusId": "string",
      "orderStatus": "string",
      "orderTotalKobo": "number",
      "providerReference": "string",
      "paymentStatus": "string",
      "expectedAmountKobo": "number",
      "paidAmountKobo": "number",
      "providerTransactionId": "string",
      "currency": "string",
      "initializedAt": "string",
      "paidAt": "string",
      "verifiedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/payments/{paymentId}/reconcile`

#### Path Parameters

| Parameter   | Type     | Required | Description |
| :---------- | :------- | :------- | :---------- |
| `paymentId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Verifies a Paystack transaction and marks the local payment successful.
  ```json
  {
    "data": {
      "paymentId": "string",
      "orderId": "string",
      "providerReference": "string",
      "status": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/payments/{paymentId}/refunds`

#### Path Parameters

| Parameter   | Type     | Required | Description |
| :---------- | :------- | :------- | :---------- |
| `paymentId` | `string` | Yes      |             |

#### Responses

- **Status 201**: Creates a bounded Paystack refund for a successful payment.
  ```json
  {
    "data": {
      "id": "string",
      "paymentId": "string",
      "orderId": "string",
      "providerRefundReference": "string",
      "amountKobo": "number",
      "reasonCode": "string",
      "reasonText": "string",
      "status": "string",
      "requestedBy": "string",
      "requestedAt": "string",
      "processedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

## vendor-batches Endpoints

### `GET /v1/vendor/batches`

#### Responses

- **Status 200**: List of delivery batches associated with the authenticated vendor.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid query filters.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/batches/{batchId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `batchId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Detailed summary of a single vendor batch, including its orders.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "vendorId": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "zoneId": "string",
      "batchNumber": "string",
      "status": "string",
      "deliveryMode": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "cutoffAt": "string",
      "closedAt": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Batch not found for this vendor.

---

### `POST /v1/vendor/batches/{batchId}/pickup`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `batchId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Batch ready for pickup, assignments updated to picked_up.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "vendorId": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "zoneId": "string",
      "batchNumber": "string",
      "status": "string",
      "deliveryMode": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "cutoffAt": "string",
      "closedAt": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 400**: Invalid batch transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Batch not found for this vendor.

---

### `POST /v1/vendor/batches/{batchId}/ready-for-pickup`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `batchId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Batch ready for pickup, assignments updated to picked_up.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "vendorId": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "zoneId": "string",
      "batchNumber": "string",
      "status": "string",
      "deliveryMode": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "cutoffAt": "string",
      "closedAt": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 400**: Invalid batch transition.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Batch not found for this vendor.

---

## rider Endpoints

### `GET /v1/rider/profile`

#### Responses

- **Status 200**: Authenticated rider profile.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "displayName": "string",
      "phone": "string",
      "status": "string",
      "active": "boolean"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.
- **Status 404**: Rider profile not found.

---

### `PATCH /v1/rider/profile`

#### Responses

- **Status 200**: Updated rider profile.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "displayName": "string",
      "phone": "string",
      "status": "string",
      "active": "boolean"
    }
  }
  ```
- **Status 400**: Invalid profile input.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/assignments`

#### Responses

- **Status 200**: Cursor-paginated assignments for the authenticated rider.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid filters or cursor.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/assignments/{assignmentId}`

#### Path Parameters

| Parameter      | Type     | Required | Description |
| :------------- | :------- | :------- | :---------- |
| `assignmentId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Assignment detail with order manifest.
  ```json
  {
    "data": {
      "id": "string",
      "batchId": "string",
      "riderId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "vendorPhone": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "deliveryTime": "string",
      "zoneId": "string",
      "zoneName": "string",
      "status": "string",
      "batchStatus": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "assignedAt": "string",
      "acceptedAt": "string",
      "pickedUpAt": "string",
      "completedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.
- **Status 404**: Assignment not found for this rider.

---

### `POST /v1/rider/assignments/{assignmentId}/accept`

#### Path Parameters

| Parameter      | Type     | Required | Description |
| :------------- | :------- | :------- | :---------- |
| `assignmentId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Assignment accepted.
  ```json
  {
    "data": {
      "id": "string",
      "batchId": "string",
      "riderId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "vendorPhone": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "deliveryTime": "string",
      "zoneId": "string",
      "zoneName": "string",
      "status": "string",
      "batchStatus": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "assignedAt": "string",
      "acceptedAt": "string",
      "pickedUpAt": "string",
      "completedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `POST /v1/rider/assignments/{assignmentId}/picked-up`

#### Path Parameters

| Parameter      | Type     | Required | Description |
| :------------- | :------- | :------- | :---------- |
| `assignmentId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Assignment marked picked up.
  ```json
  {
    "data": {
      "id": "string",
      "batchId": "string",
      "riderId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "vendorPhone": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "deliveryTime": "string",
      "zoneId": "string",
      "zoneName": "string",
      "status": "string",
      "batchStatus": "string",
      "orderCount": "number",
      "deliveryEarningsKobo": "number",
      "assignedAt": "string",
      "acceptedAt": "string",
      "pickedUpAt": "string",
      "completedAt": "string",
      "orders": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/orders/{orderId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Delivery order detail for an assigned rider.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object",
      "assignmentId": "string",
      "batchId": "string",
      "assignmentStatus": "string",
      "customerDisplayName": "string",
      "customerPhone": "string",
      "deliveryInstructions": "string",
      "zoneName": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.
- **Status 404**: Order not found for this rider.

---

### `POST /v1/rider/orders/{orderId}/out-for-delivery`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order marked out for delivery.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object",
      "assignmentId": "string",
      "batchId": "string",
      "assignmentStatus": "string",
      "customerDisplayName": "string",
      "customerPhone": "string",
      "deliveryInstructions": "string",
      "zoneName": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `POST /v1/rider/orders/{orderId}/delivered`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Order marked delivered.
  ```json
  {
    "data": {
      "id": "string",
      "orderNumber": "string",
      "customerId": "string",
      "campusId": "string",
      "vendorId": "string",
      "vendorDisplayName": "string",
      "serviceDate": "string",
      "deliverySlotId": "string",
      "deliverySlotName": "string",
      "locationId": "string",
      "locationName": "string",
      "orderStatus": "string",
      "deliveryMode": "string",
      "foodSubtotalKobo": "number",
      "deliveryFeeKobo": "number",
      "discountKobo": "number",
      "totalKobo": "number",
      "currency": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "paidAt": "string",
      "deliveredAt": "string",
      "confirmedAt": "string",
      "items": "Array<[object Object]>",
      "latestPayment": "Object",
      "assignmentId": "string",
      "batchId": "string",
      "assignmentStatus": "string",
      "customerDisplayName": "string",
      "customerPhone": "string",
      "deliveryInstructions": "string",
      "zoneName": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `POST /v1/rider/orders/{orderId}/issues`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Delivery issue recorded.
  ```json
  {
    "data": {
      "id": "string",
      "orderId": "string",
      "category": "string",
      "description": "string",
      "status": "string",
      "openedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid issue payload.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/earnings`

#### Responses

- **Status 200**: Rider earnings grouped by assignment batch.
  ```json
  {
    "data": {
      "riderId": "string",
      "dateFrom": "string",
      "dateTo": "string",
      "deliveredOrderCount": "number",
      "confirmedOrderCount": "number",
      "pendingAmountKobo": "number",
      "settledAmountKobo": "number",
      "totalAmountKobo": "number",
      "currency": "string",
      "ratePerOrderKobo": "number",
      "batches": "Array<[object Object]>"
    }
  }
  ```
- **Status 400**: Invalid earnings date range.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/settlements`

#### Responses

- **Status 200**: Cursor-paginated rider settlement list.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid settlement filters or cursor.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.

---

### `GET /v1/rider/settlements/{id}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `id`      | `string` | Yes      |             |

#### Responses

- **Status 200**: Rider settlement detail with settlement lines.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "riderId": "string",
      "settlementDate": "string",
      "status": "string",
      "deliveryEarningsKobo": "number",
      "adjustmentsKobo": "number",
      "payableKobo": "number",
      "paidAt": "string",
      "externalReference": "string",
      "lineCount": "number",
      "createdAt": "string",
      "updatedAt": "string",
      "lines": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Verified active rider access is required.
- **Status 404**: Settlement not found for this rider.

---

## settlements Endpoints

### `POST /v1/settlements/vendors/{vendorId}/daily`

#### Responses

- **Status 201**: Vendor daily settlement was generated idempotently.

---

### `POST /v1/settlements/riders/{riderId}/daily`

#### Responses

- **Status 201**: Rider daily settlement was generated idempotently.

---

## vendor-settlements Endpoints

### `GET /v1/vendor/settlements`

#### Responses

- **Status 200**: Cursor-paginated settlements for the authenticated vendor.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid filters or cursor.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.

---

### `GET /v1/vendor/settlements/{id}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `id`      | `string` | Yes      |             |

#### Responses

- **Status 200**: Settlement detail with immutable settlement lines.
  ```json
  {
    "data": {
      "id": "string",
      "campusId": "string",
      "vendorId": "string",
      "riderId": "string",
      "settlementDate": "string",
      "status": "string",
      "grossFoodAmountKobo": "number",
      "deliveryEarningsKobo": "number",
      "refundsKobo": "number",
      "adjustmentsKobo": "number",
      "payableKobo": "number",
      "paidAt": "string",
      "externalReference": "string",
      "lineCount": "number",
      "createdAt": "string",
      "updatedAt": "string",
      "lines": "Array<[object Object]>"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Vendor role and vendor membership are required.
- **Status 404**: Settlement not found for this vendor.

---

## reviews Endpoints

### `POST /v1/orders/{orderId}/review`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 201**: Created or existing customer review for an owned confirmed order.
  ```json
  {
    "data": {
      "id": "string",
      "orderId": "string",
      "reviewerId": "string",
      "menuItemId": "string",
      "vendorId": "string",
      "deliveryBatchId": "string",
      "foodRating": "number",
      "vendorRating": "number",
      "deliveryRating": "number",
      "comment": "string",
      "moderationStatus": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid review input or ineligible order.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

## vendor-reviews Endpoints

### `GET /v1/vendor/reviews`

#### Responses

- **Status 200**: Cursor-paginated customer reviews for the authenticated vendor.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 400**: Invalid review filters or cursor.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

## escalations Endpoints

### `GET /v1/orders/{orderId}/escalations`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Customer-visible escalations for an owned order.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `POST /v1/orders/{orderId}/escalations`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 201**: Opened or existing customer escalation for an owned eligible order.
  ```json
  {
    "data": {
      "id": "string",
      "orderId": "string",
      "openedBy": "string",
      "category": "string",
      "description": "string",
      "status": "string",
      "assignedAdminId": "string",
      "resolution": "string",
      "refundId": "string",
      "openedAt": "string",
      "resolvedAt": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 400**: Invalid escalation input or ineligible order.
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

## admin Endpoints

### `GET /v1/admin/session`

#### Responses

- **Status 200**: Authenticated admin session and scope.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/dashboard`

#### Responses

- **Status 200**: Admin operational dashboard for a service date.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/orders`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/orders/{orderId}`

#### Path Parameters

| Parameter | Type     | Required | Description |
| :-------- | :------- | :------- | :---------- |
| `orderId` | `string` | Yes      |             |

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/orders/{orderId}/cancel`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/orders/{orderId}/status-transition`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/batches`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/batches/{batchId}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/batches/{batchId}/close`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/batches/{batchId}/assign-rider`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/batches/{batchId}/assign-vendor-delivery`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/batches/{batchId}/reassign-rider`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/batches/{batchId}/cancel-assignment`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/vendors`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/vendors`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/vendors/{vendorId}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `PATCH /v1/admin/vendors/{vendorId}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/vendors/{vendorId}/approve`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/vendors/{vendorId}/suspend`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/vendors/{vendorId}/activate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/vendors/{vendorId}/users`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/vendors/{vendorId}/performance`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/riders`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/riders/{riderId}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/riders/{riderId}/assignments`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/riders/{riderId}/settlements`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/riders/{riderId}/verify`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/riders/{riderId}/suspend`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/riders/{riderId}/activate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/inventory`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/inventory/{inventoryId}/adjustments`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/escalations`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/escalations/{id}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/escalations/{id}/assign`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/escalations/{id}/request-evidence`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/escalations/{id}/resolve`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/escalations/{id}/refunds`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/settlements`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/settlements/preview`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/settlements/generate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/settlements/{id}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/settlements/{id}/approve`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/settlements/{id}/mark-paid`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/settlements/{id}/adjustments`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/reviews`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/reviews/{reviewId}/moderate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/users`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/users/{userId}`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/users/{userId}/suspend`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/users/{userId}/activate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/admin-memberships`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/admin-memberships`

#### Responses

- **Status 201**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/admin-memberships/{id}/revoke`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/admin-memberships/{id}/activate`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/analytics`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/audit-logs`

#### Responses

- **Status 200**:
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

## notifications Endpoints

### `GET /v1/notifications`

#### Responses

- **Status 200**: Current user notification feed.
  ```json
  {
    "data": "Array<[object Object]>"
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `POST /v1/notifications/read-all`

#### Responses

- **Status 200**: Marks all current user notifications as read.
  ```json
  {
    "data": {
      "updatedCount": "number"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `POST /v1/notifications/{notificationId}/read`

#### Path Parameters

| Parameter        | Type     | Required | Description |
| :--------------- | :------- | :------- | :---------- |
| `notificationId` | `string` | Yes      |             |

#### Responses

- **Status 200**: Marks one current user notification as read.
  ```json
  {
    "data": {
      "id": "string",
      "recipientUserId": "string",
      "eventType": "string",
      "aggregateType": "string",
      "aggregateId": "string",
      "title": "string",
      "body": "string",
      "linkPath": "string",
      "readAt": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `GET /v1/notifications/preferences`

#### Responses

- **Status 200**: Current user notification preferences.
  ```json
  {
    "data": {
      "userId": "string",
      "inAppEnabled": "boolean",
      "pushEnabled": "boolean",
      "emailEnabled": "boolean",
      "orderUpdates": "boolean",
      "paymentUpdates": "boolean",
      "deliveryUpdates": "boolean",
      "escalationUpdates": "boolean",
      "settlementUpdates": "boolean",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

### `PUT /v1/notifications/preferences`

#### Responses

- **Status 200**: Updated current user notification preferences.
  ```json
  {
    "data": {
      "userId": "string",
      "inAppEnabled": "boolean",
      "pushEnabled": "boolean",
      "emailEnabled": "boolean",
      "orderUpdates": "boolean",
      "paymentUpdates": "boolean",
      "deliveryUpdates": "boolean",
      "escalationUpdates": "boolean",
      "settlementUpdates": "boolean",
      "updatedAt": "string"
    }
  }
  ```
- **Status 401**: Missing, invalid, or expired Supabase JWT.

---

## admin-jobs Endpoints

### `GET /v1/admin/system`

#### Responses

- **Status 200**: Worker and outbox operational summary.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `GET /v1/admin/jobs/outbox`

#### Responses

- **Status 200**: Outbox event list for admin operations.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

### `POST /v1/admin/jobs/outbox/process`

#### Responses

- **Status 200**: Claims currently available outbox events for a worker.
- **Status 401**: Missing, invalid, or expired Supabase JWT.
- **Status 403**: Admin role is required.

---

## Realtime

Live updates are delivered over Supabase Realtime (`postgres_changes`) rather than polling.
Clients connect with `supabase-js` using the authenticated user's JWT; row-level security is
enforced on every change event over the channel, so a subscriber only receives rows it is
permitted to read.

Subscribed tables and recommended filters:

- `public.orders` — filter `customer_id=eq.<uid>`. Customers receive status transitions for
  their own orders. Row shape matches the `GET /v1/orders/{orderId}` payload.
- `public.notifications` — filter `recipient_user_id=eq.<uid>`. New in-app notifications are
  materialized from outbox events; row shape matches the `GET /v1/notifications` list items.
- `public.delivery_assignments` — riders subscribe to their assignments; access is constrained
  by the existing RLS policies on the table.

Example subscription:

```ts
supabase
  .channel('orders')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${userId}` },
    (payload) => handleOrderChange(payload.new)
  )
  .subscribe();
```

Realtime is a read-side projection only; all mutations continue to go through the REST API,
which remains the source of truth and emits the events that drive these change feeds.
