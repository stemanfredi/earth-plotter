# Esri's imagery with your own key

Earth Plotter's satellite imagery is EOX's Sentinel-2 cloudless mosaic, one a
year, at 10 m: coastlines, fields, rivers and roads, not single buildings.
Esri's World Imagery is sharper, about 0.3–1 m in most places, but Esri's
terms allow it only with an ArcGIS account. So the page shows it only with a
key of your own, which you can get for free. This page says how.

## What you get, and what it costs

- **An ArcGIS Location Platform account**, free. Its free tier gives
  2 million basemap tiles a month, plenty for one person. Past that, access
  stops until the next month. You are not billed unless you switch on
  pay-as-you-go in the account's billing settings.
- **A key** for basemaps only, listing the sites it may be used on, valid
  until the date you set (a year at most).

## Getting the key

Esri's own tutorial, with screenshots:
[Create an API key](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/tutorials/create-an-api-key/).
The choices for Earth Plotter:

1. Sign up at [location.arcgis.com](https://location.arcgis.com) for a free
   ArcGIS Location Platform account, and sign in.
2. In the dashboard, **My portal**, then **Content › My content › New item ›
   Developer credentials › API key credentials**.
3. **Where will you use these credentials?** Public application.
4. **Item access:** No item access.
5. **Privileges:** only **Basemaps**, under location services. Nothing else:
   the page needs no other service, and a key should open no more than it
   needs.
6. **Expiration date:** as far as it allows (a year). Note the date.
7. **Referrers:** the address of the site you use the page on, as the page
   shows it beside the key field, for example `https://earthplotter.org`. For
   a copy of the page, its own address. The scheme and port must match
   exactly (`http://localhost:8099` is not `http://127.0.0.1:8099`).
8. Give it any title, save, and **generate the key**. Copy it at once: Esri
   shows it only this one time.

The expiration date and the referrers can be changed later in the key's
settings, but only with a new key: Esri invalidates the old one, and the
page has to be given the new one. So set them now.

## Using it

In the page: **Layers › Satellite**, choose **Esri World Imagery · your key**,
paste the key, **Use**. The page asks Esri whether it accepts the key from
this site. Then:

- **Accepted:** the key is kept in this browser, and Esri's imagery is drawn,
  with Esri's credit.
- **Not accepted:** the key is wrong, expired, lacks the Basemaps privilege,
  or does not list this site among its referrers; or the browser, or one of
  its extensions, sends Esri no referrer (some privacy settings strip it). The
  page says so, keeps nothing, and keeps showing Sentinel-2.

The page asks again once each time it starts with Esri's imagery: a key Esri
no longer accepts (expired, revoked) is forgotten. **Remove key** forgets it.

## Where the key goes

- It stays in this browser (its local storage), until you remove it. It is
  never in the page's address, a shared link, a downloaded drawing or an
  offline area.
- It goes to Esri, and only to Esri: when the page checks it, and, once Esri
  accepted it, with each imagery tile. Those requests carry this site's
  address (its origin, nothing more): Esri checks a key's referrers against
  it when the page asks, and the tiles carry it in case Esri's tile service
  starts to. Every other provider, and Esri's tile service before a key is
  accepted, gets no referrer at all.
- Esri's imagery is never kept for use without a connection: Esri's terms do
  not allow it.

Keep a copy of the key somewhere private, such as a password manager, and
do not post it. Esri's tile service does not check a key's referrers today:
anyone with the key could use it against your free allowance. If it leaks, regenerate it from its item in your portal.
