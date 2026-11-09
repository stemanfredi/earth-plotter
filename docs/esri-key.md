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

Expiration date and referrers cannot be changed later without making a new
key, so set them now.

## Using it

In the page: **Layers › Satellite**, choose **Esri World Imagery · your key**,
paste the key, **Use**. The page asks Esri whether it accepts the key from
this site. Then:

- **Accepted:** Esri's imagery is drawn, with Esri's credit.
- **Not accepted:** the key is wrong, expired, lacks the Basemaps privilege,
  or does not list this site among its referrers. The page says so and keeps
  showing Sentinel-2.

The page asks again each time it starts with Esri's imagery, so a key that
expires or is revoked stops being used. **Remove key** forgets it.

## Where the key goes

- It stays in this browser (its local storage), until you remove it. It is
  never in the page's address, a shared link, a downloaded drawing or an
  offline area.
- It goes to Esri, and only to Esri: with each imagery tile, and when the page
  checks it. With those requests the page sends this site's address (its
  origin, nothing more), because that is how Esri checks a key's referrers.
  Every other provider gets no referrer at all.
- Esri's imagery is never kept for use without a connection: Esri's terms do
  not allow it.

Keep a copy of the key somewhere private, such as a password manager, and
do not post it. Esri checks a key's referrers when the page asks about it, but
its tile service does not check them: anyone with the key could use it against
your free allowance. If it leaks, regenerate it from its item in your portal.
