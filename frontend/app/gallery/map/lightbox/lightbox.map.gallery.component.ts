import {Component, ElementRef, HostListener, Input, OnChanges, ViewChild, AfterViewInit} from '@angular/core';
import {PhotoDTO} from '../../../../../common/entities/PhotoDTO';
import {Dimension} from '../../../model/IRenderable';
import {FullScreenService} from '../../fullscreen.service';
import {AgmMap, LatLngBounds, MapsAPILoader} from '@agm/core';
import {IconThumbnail, Thumbnail, ThumbnailManagerService} from '../../thumnailManager.service';
import {MediaIcon} from '../../MediaIcon';
import {Media} from '../../Media';
import {PageHelper} from '../../../model/page.helper';
import {OrientationTypes} from 'ts-exif-parser';
import {MediaDTO} from '../../../../../common/entities/MediaDTO';
import {FileDTO} from '../../../../../common/entities/FileDTO';
import {NetworkService} from '../../../model/network/network.service';
import {Utils} from '../../../../../common/Utils';
import {Config} from '../../../../../common/config/public/Config';
import {MapPath, MapService} from '../map.service';


@Component({
  selector: 'app-gallery-map-lightbox',
  styleUrls: ['./lightbox.map.gallery.component.css'],
  templateUrl: './lightbox.map.gallery.component.html',
})
export class GalleryMapLightboxComponent implements OnChanges, AfterViewInit {

  @Input() photos: PhotoDTO[];
  @Input() gpxFiles: FileDTO[];
  private startPosition: Dimension = null;
  public lightboxDimension: Dimension = <Dimension>{top: 0, left: 0, width: 0, height: 0};
  public mapDimension: Dimension = <Dimension>{top: 0, left: 0, width: 0, height: 0};
  public visible = false;
  public controllersVisible = false;
  public opacity = 1.0;
  mapPhotos: MapPhoto[] = [];
  paths: MapPath[][] = [];
  pathOutlines: MapPath[][] = [];
  mapCenter = {latitude: 0, longitude: 0};

  @ViewChild('root') elementRef: ElementRef;

  @ViewChild(AgmMap) map: AgmMap;


  constructor(public fullScreenService: FullScreenService,
              private thumbnailService: ThumbnailManagerService,
              private mapService: MapService,
              private mapsAPILoader: MapsAPILoader) {
  }

  ngOnChanges() {
    if (this.visible === false) {
      return;
    }
    this.showImages();
  }

  ngAfterViewInit() {

  }

  public show(position: Dimension) {
    this.hideImages();
    this.visible = true;
    this.opacity = 1.0;
    this.startPosition = position;
    this.lightboxDimension = position;
    this.lightboxDimension.top -= PageHelper.ScrollY;
    this.mapDimension = <Dimension>{
      top: 0,
      left: 0,
      width: this.getScreenWidth(),
      height: this.getScreenHeight()
    };
    this.map.triggerResize().then(() => {
      this.controllersVisible = true;
    });

    PageHelper.hideScrollY();

    setTimeout(() => {
      this.lightboxDimension = <Dimension>{
        top: 0,
        left: 0,
        width: this.getScreenWidth(),
        height: this.getScreenHeight()
      };
      this.showImages();
    }, 0);
  }

  public hide() {
    this.fullScreenService.exitFullScreen();
    this.controllersVisible = false;
    const to = this.startPosition;

    // iff target image out of screen -> scroll to there
    if (PageHelper.ScrollY > to.top || PageHelper.ScrollY + this.getScreenHeight() < to.top) {
      PageHelper.ScrollY = to.top;
    }

    this.lightboxDimension = this.startPosition;
    this.lightboxDimension.top -= PageHelper.ScrollY;
    PageHelper.showScrollY();
    this.opacity = 0.0;
    setTimeout(() => {
      this.visible = false;
      this.hideImages();
    }, 500);
  }

  showImages() {
    this.hideImages();

    this.mapPhotos = this.photos.filter(p => {
      return p.metadata && p.metadata.positionData && p.metadata.positionData.GPSData
        && p.metadata.positionData.GPSData.latitude
        && p.metadata.positionData.GPSData.longitude;
    }).map(p => {
      let width = 500;
      let height = 500;
      const rotatedSize = MediaDTO.getRotatedSize(p);
      if (rotatedSize.width > rotatedSize.height) {
        height = width * (rotatedSize.height / rotatedSize.width);
      } else {
        width = height * (rotatedSize.width / rotatedSize.height);
      }
      const iconTh = this.thumbnailService.getIcon(new MediaIcon(p));
      iconTh.Visible = true;
      const obj: MapPhoto = {
        latitude: p.metadata.positionData.GPSData.latitude,
        longitude: p.metadata.positionData.GPSData.longitude,
        iconThumbnail: iconTh,
        orientation: p.metadata.orientation,
        preview: {
          width: width,
          height: height,
          thumbnail: this.thumbnailService.getLazyThumbnail(new Media(p, width, height))
        }

      };
      if (iconTh.Available === true) {
        obj.iconUrl = iconTh.Src;
      } else {
        iconTh.OnLoad = () => {
          obj.iconUrl = iconTh.Src;
        };
      }
      return obj;
    });

    if (this.gpxFiles) {
      this.loadGPXFiles().catch(console.error);
    }

  }


  private gpxFilter(list: MapPath[]) {
    let last = list[0];
    const out = [];
    for (let i = 1; i < list.length; i++) {
      if (this.mapService.calcDistance(list[i], last) > 0.5) {
        out.push(list[i]);
        last = list[i];
      }
    }
    if (out.length < 2) {
      out.push(list[list.length - 1]);
    }
    return out;
  }

  private async loadGPXFiles(): Promise<void> {
    this.paths = [];
    for (let i = 0; i < this.gpxFiles.length; i++) {
      const file = this.gpxFiles[i];
      const path = await this.mapService.getMapPath(file);
      if (file !== this.gpxFiles[i]) { // check race condition
        return;
      }
      if (path.length === 0) {
        continue;
      }
      this.paths.push(path);
      this.pathOutlines.push(this.gpxFilter(path));
    }
  }


  public loadPreview(mp: MapPhoto) {
    mp.preview.thumbnail.load();
    mp.preview.thumbnail.CurrentlyWaiting = true;
  }

  hideImages() {
    this.mapCenter = {longitude: 0, latitude: 0};
    this.mapPhotos.forEach((mp) => {
      mp.iconThumbnail.destroy();
      mp.preview.thumbnail.destroy();
    });
    this.mapPhotos = [];
  }


  private getScreenWidth() {
    return window.innerWidth;
  }

  private getScreenHeight() {
    return window.innerHeight;
  }

  //noinspection JSUnusedGlobalSymbols
  @HostListener('window:keydown', ['$event'])
  onKeyPress(e: KeyboardEvent) {
    if (this.visible !== true) {
      return;
    }
    const event: KeyboardEvent = window.event ? <any>window.event : e;
    switch (event.key) {
      case 'Escape': // escape
        this.hide();
        break;
    }
  }


}

export interface MapPhoto {
  latitude: number;
  longitude: number;
  iconUrl?: string;
  iconThumbnail: IconThumbnail;
  orientation: OrientationTypes;
  preview: {
    width: number;
    height: number;
    thumbnail: Thumbnail;
  };
}

